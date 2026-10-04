package com.leslietavern.dreamland.mobile;

import android.annotation.SuppressLint;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.Menu;
import android.view.MenuItem;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.Nullable;
import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;
import androidx.appcompat.widget.Toolbar;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.core.view.WindowInsetsCompat;

import com.google.android.material.button.MaterialButton;
import com.google.android.material.switchmaterial.SwitchMaterial;
import com.google.android.material.textfield.TextInputEditText;
import com.google.android.material.textfield.TextInputLayout;
import com.leslietavern.dreamland.mobile.ServerAddress;

import java.io.ByteArrayInputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.util.Collections;

/** Shared phone/tablet shell for connected and on-device DreamLand runtimes. */
public final class MainActivity extends AppCompatActivity {
    private static final String PREFS = "dreamland_mobile_client";
    private static final String PREF_SERVER = "server_address";
    private static final String PREF_REMEMBER = "remember_server";
    private static final int FILE_CHOOSER_REQUEST = 7312;
    private static final String STANDALONE_ORIGIN = "http://127.0.0.1:18790";

    private LinearLayout root;
    private Toolbar toolbar;
    private FrameLayout content;
    private WebView webView;
    private URI serverOrigin;
    private ValueCallback<Uri[]> fileChooserCallback;
    private boolean connected;

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        buildShell();
        applySystemInsets();
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (webView != null && webView.canGoBack()) {
                    webView.goBack();
                } else if (connected && !BuildConfig.STANDALONE) {
                    showConnectScreen(null);
                } else {
                    setEnabled(false);
                    getOnBackPressedDispatcher().onBackPressed();
                    setEnabled(true);
                }
            }
        });
        if (BuildConfig.STANDALONE) {
            startStandaloneServer();
        } else {
            showConnectScreen(null);
            String remembered = getPreferences(MODE_PRIVATE).getString(PREF_SERVER, "");
            boolean remember = getPreferences(MODE_PRIVATE).getBoolean(PREF_REMEMBER, true);
            if (remember && !remembered.isBlank()) connect(remembered, true);
        }
    }

    private void buildShell() {
        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(getColor(R.color.dreamland_background));

        toolbar = new Toolbar(this);
        toolbar.setTitle(R.string.app_name);
        toolbar.setTitleTextColor(getColor(R.color.dreamland_on_surface));
        toolbar.setBackgroundColor(getColor(R.color.dreamland_background));
        toolbar.setElevation(dp(2));
        toolbar.setOnMenuItemClickListener(item -> {
            if (item.getItemId() == 1) {
                showConnectScreen(null);
                return true;
            }
            return false;
        });
        root.addView(toolbar, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(56)));

        content = new FrameLayout(this);
        root.addView(content, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        setContentView(root);
    }

    private void applySystemInsets() {
        ViewCompat.setOnApplyWindowInsetsListener(root, (view, windowInsets) -> {
            Insets bars = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars());
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            boolean lightTheme = (getResources().getConfiguration().uiMode
                    & android.content.res.Configuration.UI_MODE_NIGHT_MASK)
                    != android.content.res.Configuration.UI_MODE_NIGHT_YES;
            WindowInsetsControllerCompat controller = new WindowInsetsControllerCompat(getWindow(), root);
            controller.setAppearanceLightStatusBars(lightTheme);
            controller.setAppearanceLightNavigationBars(lightTheme);
            return WindowInsetsCompat.CONSUMED;
        });
    }

    private void showConnectScreen(@Nullable String message) {
        connected = false;
        toolbar.setVisibility(View.VISIBLE);
        toolbar.getMenu().clear();
        content.removeAllViews();
        if (webView != null) {
            content.removeView(webView);
            webView.stopLoading();
            webView.destroy();
            webView = null;
        }

        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        LinearLayout stage = new LinearLayout(this);
        stage.setGravity(Gravity.CENTER);
        stage.setPadding(dp(24), dp(24), dp(24), dp(24));
        scroll.addView(stage, new ScrollView.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(24), dp(28), dp(24), dp(24));
        android.graphics.drawable.GradientDrawable cardBackground = new android.graphics.drawable.GradientDrawable();
        cardBackground.setColor(getColor(R.color.dreamland_surface));
        cardBackground.setCornerRadius(dp(24));
        card.setBackground(cardBackground);
        card.setClipToOutline(true);
        card.setElevation(dp(2));
        ViewGroup.LayoutParams cardParams = new ViewGroup.LayoutParams(
                Math.min(getResources().getDisplayMetrics().widthPixels
                        - root.getPaddingLeft() - root.getPaddingRight() - dp(48), dp(480)),
                ViewGroup.LayoutParams.WRAP_CONTENT);
        stage.addView(card, cardParams);

        TextView title = new TextView(this);
        title.setText(R.string.connect_title);
        title.setTextSize(24);
        title.setTextColor(getColor(R.color.dreamland_on_surface));
        title.setTypeface(null, android.graphics.Typeface.BOLD);
        card.addView(title);

        TextView help = new TextView(this);
        help.setText(R.string.connect_help);
        help.setTextSize(15);
        help.setTextColor(getColor(R.color.dreamland_text_secondary));
        help.setPadding(0, dp(10), 0, dp(22));
        card.addView(help);

        TextInputLayout addressLayout = new TextInputLayout(this);
        addressLayout.setHint(getString(R.string.server_address_label));
        addressLayout.setBoxBackgroundMode(TextInputLayout.BOX_BACKGROUND_OUTLINE);
        TextInputEditText addressInput = new TextInputEditText(addressLayout.getContext());
        addressInput.setSingleLine(true);
        addressInput.setInputType(android.text.InputType.TYPE_CLASS_TEXT
                | android.text.InputType.TYPE_TEXT_VARIATION_URI);
        addressInput.setAutofillHints("url");
        addressInput.setHint(getString(R.string.server_address_hint));
        String rememberedAddress = getPreferences(MODE_PRIVATE).getString(PREF_SERVER, "");
        addressInput.setText(rememberedAddress);
        addressLayout.addView(addressInput, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        card.addView(addressLayout);

        SwitchMaterial rememberSwitch = new SwitchMaterial(this);
        rememberSwitch.setText(R.string.remember_address);
        rememberSwitch.setChecked(getPreferences(MODE_PRIVATE).getBoolean(PREF_REMEMBER, true));
        LinearLayout.LayoutParams switchParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        switchParams.topMargin = dp(14);
        card.addView(rememberSwitch, switchParams);

        if (message != null) {
            TextView error = new TextView(this);
            error.setText(message);
            error.setTextColor(getColor(R.color.dreamland_error));
            error.setTextSize(14);
            error.setPadding(0, dp(12), 0, 0);
            card.addView(error);
        }

        MaterialButton connectButton = new MaterialButton(this);
        connectButton.setText(R.string.connect_button);
        LinearLayout.LayoutParams buttonParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        buttonParams.topMargin = dp(20);
        card.addView(connectButton, buttonParams);
        connectButton.setOnClickListener(view -> {
            addressLayout.setError(null);
            String raw = addressInput.getText() == null ? "" : addressInput.getText().toString();
            try {
                URI address = ServerAddress.parse(raw);
                getPreferences(MODE_PRIVATE).edit()
                        .putBoolean(PREF_REMEMBER, rememberSwitch.isChecked())
                        .apply();
                if (rememberSwitch.isChecked()) {
                    getPreferences(MODE_PRIVATE).edit().putString(PREF_SERVER, address.toString()).apply();
                } else {
                    getPreferences(MODE_PRIVATE).edit().remove(PREF_SERVER).apply();
                }
                connect(address.toString(), false);
            } catch (IllegalArgumentException exception) {
                addressLayout.setError(exception.getMessage());
            }
        });

        TextView privacy = new TextView(this);
        privacy.setText(R.string.connection_privacy);
        privacy.setTextSize(13);
        privacy.setTextColor(getColor(R.color.dreamland_text_secondary));
        privacy.setPadding(0, dp(18), 0, 0);
        card.addView(privacy);

        content.addView(scroll, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    private void startStandaloneServer() {
        connected = false;
        toolbar.setVisibility(View.VISIBLE);
        toolbar.getMenu().clear();
        toolbar.setSubtitle(R.string.local_server_subtitle);
        content.removeAllViews();
        TextView status = new TextView(this);
        status.setGravity(Gravity.CENTER);
        status.setPadding(dp(32), dp(32), dp(32), dp(32));
        status.setText(R.string.local_server_starting);
        status.setTextColor(getColor(R.color.dreamland_text_secondary));
        status.setTextSize(16);
        content.addView(status, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        Intent serviceIntent = new Intent();
        serviceIntent.setClassName(this, "com.leslietavern.dreamland.mobile.LocalDreamLandService");
        try {
            androidx.core.content.ContextCompat.startForegroundService(this, serviceIntent);
        } catch (RuntimeException exception) {
            showStandaloneError(getString(R.string.local_server_start_failed));
            return;
        }

        new Thread(() -> {
            boolean ready = false;
            for (int attempt = 0; attempt < 180 && !isFinishing(); attempt++) {
                HttpURLConnection connection = null;
                try {
                    connection = (HttpURLConnection) new URL(STANDALONE_ORIGIN).openConnection();
                    connection.setConnectTimeout(900);
                    connection.setReadTimeout(900);
                    connection.setInstanceFollowRedirects(false);
                    connection.setRequestMethod("GET");
                    int statusCode = connection.getResponseCode();
                    ready = statusCode >= 200 && statusCode < 400;
                } catch (Exception ignored) {
                    // The Node service may still be extracting assets or compiling the web client.
                } finally {
                    if (connection != null) connection.disconnect();
                }
                if (ready) break;
                try {
                    Thread.sleep(1000);
                } catch (InterruptedException exception) {
                    Thread.currentThread().interrupt();
                    break;
                }
            }
            boolean serverReady = ready;
            new Handler(Looper.getMainLooper()).post(() -> {
                if (isFinishing() || isDestroyed()) return;
                if (serverReady) connect(STANDALONE_ORIGIN, true);
                else showStandaloneError(getString(R.string.local_server_start_failed));
            });
        }, "DreamLand-server-readiness").start();
    }

    private void showStandaloneError(String message) {
        connected = false;
        toolbar.setVisibility(View.VISIBLE);
        toolbar.getMenu().clear();
        toolbar.setSubtitle(R.string.local_server_subtitle);
        content.removeAllViews();
        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setGravity(Gravity.CENTER);
        panel.setPadding(dp(28), dp(28), dp(28), dp(28));
        TextView error = new TextView(this);
        error.setText(message);
        error.setTextColor(getColor(R.color.dreamland_error));
        error.setTextSize(16);
        panel.addView(error);
        MaterialButton retry = new MaterialButton(this);
        retry.setText(R.string.retry_local_server);
        retry.setOnClickListener(view -> startStandaloneServer());
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        params.topMargin = dp(20);
        panel.addView(retry, params);
        content.addView(panel, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void connect(String rawAddress, boolean automatic) {
        final URI address;
        try {
            if (BuildConfig.STANDALONE) {
                if (!STANDALONE_ORIGIN.equals(rawAddress)) {
                    throw new IllegalArgumentException("Standalone mode only connects to its on-device server.");
                }
                address = URI.create(STANDALONE_ORIGIN);
            } else {
                address = ServerAddress.parse(rawAddress);
            }
        } catch (IllegalArgumentException exception) {
            if (BuildConfig.STANDALONE) {
                showStandaloneError(getString(R.string.local_server_start_failed));
            } else {
                showConnectScreen(exception.getMessage());
            }
            return;
        }
        serverOrigin = address;
        connected = true;
        toolbar.setVisibility(View.GONE);
        toolbar.getMenu().clear();
        if (BuildConfig.STANDALONE) {
            toolbar.setSubtitle(R.string.local_server_subtitle);
        } else {
            toolbar.getMenu().add(Menu.NONE, 1, Menu.NONE, R.string.switch_server)
                    .setIcon(android.R.drawable.ic_menu_manage)
                    .setShowAsAction(MenuItem.SHOW_AS_ACTION_IF_ROOM | MenuItem.SHOW_AS_ACTION_WITH_TEXT);
            toolbar.setSubtitle(address.getHost());
        }
        content.removeAllViews();

        webView = new WebView(this);
        webView.setBackgroundColor(Color.WHITE);
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setSafeBrowsingEnabled(true);
        settings.setUserAgentString(settings.getUserAgentString() + (BuildConfig.STANDALONE
                ? " DreamLandAndroidStandalone/0.1" : " DreamLandAndroidClient/0.1"));
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                URI candidate = uriOrNull(request.getUrl().toString());
                if (candidate != null && ServerAddress.sameOrigin(serverOrigin, candidate)) return false;
                if (candidate != null && ("mailto".equalsIgnoreCase(candidate.getScheme())
                        || "tel".equalsIgnoreCase(candidate.getScheme()))) {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(candidate.toString())));
                    } catch (Exception ignored) {
                        showToast(getString(R.string.external_link_blocked));
                    }
                } else {
                    showToast(getString(R.string.external_link_blocked));
                }
                return true;
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                URI candidate = uriOrNull(request.getUrl().toString());
                if (candidate != null && ServerAddress.isPrivateOrLoopbackHost(candidate.getHost())
                        && !ServerAddress.sameOrigin(serverOrigin, candidate)) {
                    return new WebResourceResponse("text/plain", "utf-8", 403, "Blocked",
                            Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
                }
                return super.shouldInterceptRequest(view, request);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                super.onReceivedError(view, request, error);
                if (request.isForMainFrame() && connected) {
                    if (BuildConfig.STANDALONE) showStandaloneError(getString(R.string.local_server_start_failed));
                    else showConnectScreen(getString(R.string.connection_failed));
                }
            }

        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileChooserCallback != null) fileChooserCallback.onReceiveValue(null);
                fileChooserCallback = callback;
                Intent intent;
                try {
                    intent = params.createIntent();
                    startActivityForResult(intent, FILE_CHOOSER_REQUEST);
                } catch (Exception exception) {
                    fileChooserCallback = null;
                    callback.onReceiveValue(null);
                    return false;
                }
                return true;
            }
        });
        content.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        webView.loadUrl(address.toString());
    }

    @Nullable
    private static URI uriOrNull(String value) {
        try {
            return URI.create(value);
        } catch (IllegalArgumentException exception) {
            return null;
        }
    }

    private int dp(float value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private void showToast(String message) {
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show();
    }

    @Override
    @SuppressWarnings("deprecation")
    protected void onActivityResult(int requestCode, int resultCode, @Nullable Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_CHOOSER_REQUEST && fileChooserCallback != null) {
            Uri[] results = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
            fileChooserCallback.onReceiveValue(results);
            fileChooserCallback = null;
        }
    }

    @Override
    protected void onDestroy() {
        if (fileChooserCallback != null) fileChooserCallback.onReceiveValue(null);
        if (webView != null) webView.destroy();
        super.onDestroy();
    }
}
