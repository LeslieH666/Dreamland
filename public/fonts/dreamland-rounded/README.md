# DreamLand UI Rounded CN

This local WOFF2 font is a renamed, common-character subset of **Resource Han
Rounded CN v1.910** by Cyano Hao, derived from Source Han Sans. The font remains
under SIL Open Font License 1.1; copyright and the full license are in `OFL.txt`.
Original download and derived-file checksums are recorded in `source.json`.

- Upstream: https://github.com/CyanoHao/Resource-Han-Rounded
- Pinned archive: `RHR-CFF2-CN-1.910.7z`, release `v1.910`.
- Changes: GB2312, Latin, kana, punctuation and UI symbols; renamed family;
  WOFF2 compression. Original variable weight and rounding axes are retained;
  the upstream rounding default is 100.
- Integration: MomoTalk UI and login only, `font-display: swap`. No remote font
  requests, font-ready startup gate or user settings migration. Rare characters
  use the existing system fallback. Font Awesome icons and code fonts retain
  their own typefaces.

The screenshot candidate **BlueakaBeta2GBK** is not included: its redistributable
license has not been verified. This font is a rounded substitute, not a claim of
an identical game typeface.

To rebuild, extract the pinned archive and run from the repository root with
fontTools and Brotli installed:

```powershell
python scripts/prepare-dreamland-font.py path/to/ResourceHanRoundedCN-VF.otf
```

The builder verifies the source OTF checksum before writing derived output.
