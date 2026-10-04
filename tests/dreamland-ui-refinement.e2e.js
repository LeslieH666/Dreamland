/* global localStorage, document, innerWidth, globalThis */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { chromium, expect, test } from '@playwright/test';

test('aligned headers, random creation and feed-first Moments preserve drafts', async () => {
    test.skip(!process.env.LESLIE_SYNTHETIC_SHOWCASE, 'Requires an isolated synthetic data root.'); // eslint-disable-line playwright/no-skipped-test
    test.setTimeout(60000);
    const browser = await chromium.launch({ channel:'msedge',headless:true });
    const page = await browser.newPage({ viewport:{ width:1920,height:1080 } });
    const errors = [];page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>localStorage.setItem('language','zh-cn'));
    await page.route('**/api/secrets/read',r=>r.fulfill({ json:{} }));
    await page.route('**/api/horde/status',r=>r.fulfill({ json:{ ok:false } }));
    await page.route('**/api/horde/text-models',r=>r.fulfill({ json:[] }));
    async function ready(){await page.locator('#preloader').waitFor({ state:'hidden',timeout:30000 });await page.locator('body[data-ba-assets="ready"]').waitFor();}
    const nav = a=>page.locator('.dreamland-navigation [data-action="' + a + '"]');
    fs.mkdirSync('test-results/ui-refinement',{ recursive:true });
    async function shot(name){await page.evaluate(()=>globalThis.toastr?.remove());await page.screenshot({ path:'test-results/ui-refinement/' + name + '.png',animations:'disabled' });}
    try{
        await page.goto(process.env.LESLIE_TEST_BASE_URL || 'http://127.0.0.1:8000/');await ready();
        await page.evaluate(async()=>{const a = await import('/script.js');await fetch('/api/leslie/demo-mode/switch',{ method:'POST',headers:a.getRequestHeaders(),body:JSON.stringify({ enabled:true }) });});await page.reload();await ready();
        for(const [action,selector] of [['home','.dreamland-home-page > header'],['workshop','.leslie-character-workshop-header'],['moments','.leslie-moments-header'],['settings','.leslie-settings-header']]){
            await nav(action).click();await expect(page.locator(selector)).toBeVisible();
            const left = await page.locator('.leslie-sidebar-header').boundingBox(),right = await page.locator(selector).boundingBox();
            assert(Math.abs(left.y - right.y) < 1,action + ' top');assert(Math.abs(left.height - right.height) < 1,action + ' bottom ' + JSON.stringify({ left,right }));
        }
        const logo = await page.locator('.dreamland-momotalk-brand strong').boundingBox();assert.equal(logo.width / logo.height,4);
        await nav('workshop').click();
        await page.locator('[data-workshop-field="name"]').fill('不要覆盖的合成表单');
        await page.locator('[data-workshop-prompt]').fill('不要覆盖的合成创作说明');
        await page.locator('[data-workshop-action="random"]').hover();await expect(page.locator('[data-workshop-action="random-preferences"]')).toBeVisible();
        await page.locator('[data-workshop-action="random-preferences"]').click();
        await page.locator('[data-random-field="gender"]').selectOption('女性');await page.locator('[data-random-include]').fill('书店');await page.locator('[data-random-exclude]').fill('王室');
        await page.locator('[data-workshop-action="random-preferences-save"]').click();
        await page.locator('[data-workshop-action="random-preferences"]').click();await expect(page.locator('[data-random-include]')).toHaveValue('书店');
        await shot('workshop-preferences');await page.locator('[data-workshop-action="random-preferences-close"]').click();
        await page.evaluate(async()=>{const m = await import('/scripts/leslie-local-model-core.js');m.setLocalModelLoadingEnabled(true);});
        await page.locator('[data-workshop-provider]').selectOption('local');
        const requests = [];
        await page.route('http://127.0.0.1:5001/v1/models',r=>r.fulfill({ json:{ data:[{ id:'synthetic-model' }] } }));
        const card = { spec:'chara_card_v3',spec_version:'3.0',data:{ name:'合成随机书店角色',description:'一位在书店工作的成年女性，独立生活，没有王室背景。',personality:'克制但好奇，热爱修复旧书，有耐心且坚持自己的边界。',scenario:'现代城市的书店，角色与用户第一次认识。',first_mes:'“这本书刚修好，你可以先看看封面。”',mes_example:'<START>\n[USER]: 你认识我吗？\n[CHAR]: 我们今天第一次见。\n<START>\n[USER]: 可以看看这本书吗？\n[CHAR]: 可以，请轻一点翻。\n<START>\n[USER]: 你会一直等我吗？\n[CHAR]: 我晚上要关店，你有空再来。\n<START>\n[USER]: 你在想什么？\n[CHAR]: 在想这张旧书页还能不能修好。',system_prompt:'保持独立人格和认知边界，不代替用户行动或同意。',post_history_instructions:'一个即时反应，最多两行，不替用户说话。',creator_notes:'合成测试',tags:['原创'],extensions:{ depth_prompt:{ prompt:'保持独立人格',depth:0,role:'system' } } } };
        const responses = [{ name:'合成随机书店角色',mode:'original',hardFacts:['成年女性','书店'],requiresKnowledgeCheck:false }, { card,avatar_prompt:{ positive:'adult woman in bookshop',negative:'text' } },{ card,avatar_prompt:{ positive:'adult woman in bookshop',negative:'text' },review:{ summary:'合成审校' } }];
        await page.route('http://127.0.0.1:5001/v1/chat/completions',async r=>{requests.push(r.request().postDataJSON());await r.fulfill({ json:{ choices:[{ message:{ content:JSON.stringify(responses.shift()) } }] } });});
        await page.locator('[data-workshop-action="random"]').click();await expect(page.locator('[data-workshop-section="preview"]')).toBeVisible({ timeout:15000 });
        assert.equal(requests.length,3);assert.match(requests[0].messages[1].content,/必须排除：王室/);
        await expect(page.locator('[data-workshop-field="name"]')).toHaveValue('不要覆盖的合成表单');await expect(page.locator('[data-workshop-prompt]')).toHaveValue('不要覆盖的合成创作说明');
        await expect(page.locator('[data-workshop-avatar-prompt]')).toContainText('adult woman');
        await shot('random-preview');
        await nav('moments').click();await expect(page.locator('.leslie-moments-feed')).toBeVisible();
        await expect(page.locator('#leslie-moments-content')).toHaveCount(0);await expect(page.locator('.leslie-moments-online-model')).toHaveCount(0);
        await shot('moments-feed');
        await page.locator('[data-moments-action="compose"]').click();await page.locator('#leslie-moments-content').fill('合成发布草稿');
        await page.locator('[data-moments-action="compose-close"]').click();await page.locator('[data-moments-action="compose"]').click();await expect(page.locator('#leslie-moments-content')).toHaveValue('合成发布草稿');
        await page.locator('[data-moments-action="compose-close"]').click();
        await page.locator('[data-moments-action="compose-focus"]').click();
        await expect(page.locator('#leslie-moments-content')).toHaveValue('合成发布草稿');
        await page.locator('[data-moments-action="compose-close"]').click();
        await page.locator('[data-moments-action="preferences"]').click();await expect(page.locator('#leslie-moments-enthusiasm-slider')).toBeVisible();await shot('moments-settings');
        await page.keyboard.press('Escape');
        await expect(page.locator('.leslie-moments-preferences')).toHaveCount(0);
        await expect(page.locator('[data-moments-action="preferences"]')).toBeFocused();
        for(const width of [390,320]){
            await page.setViewportSize({ width,height:844 });await nav('moments').click();await expect(page.locator('.leslie-moments-feed')).toBeVisible();
            await page.locator('[data-moments-action="preferences"]').click();await expect(page.locator('.leslie-moments-preferences')).toBeVisible();await shot('moments-settings-' + width);
            await page.locator('[data-moments-action="preferences-close"]').click();await nav('workshop').click();await page.locator('[data-workshop-action="random-preferences"]').click();await expect(page.locator('[data-random-exclude]')).toHaveValue('王室');await shot('random-settings-' + width);
            assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth),true);
            assert((await page.locator('.leslie-character-workshop-logo').boundingBox()).x >= 0, 'Mobile heading stays inside the viewport');
            await page.locator('[data-workshop-action="random-preferences-close"]').click();
        }
        assert.deepEqual(errors,[]);console.log('PASS aligned headers, 4:1 logo, hover/mobile preferences, three-stage mock random creation, preserved workshop/publish drafts, feed-first moments, desktop/mobile panels.');
    }finally{await browser.close();}

});
