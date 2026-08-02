# Open font inspection fixtures

These fonts are test-only and are not imported by the web or Electron bundles.
They cover the three Slice 05 parser classes with pinned upstream provenance.

| File | Coverage | Upstream commit and path | SHA-256 | License |
|---|---|---|---|---|
| `Anton-Regular.ttf` | Static TrueType | `google/fonts@e0a8124cf36bb7c32ca68e5d46d6acdbc3df866a`, `ofl/anton/Anton-Regular.ttf` | `a4ba3a92350ebb031da0cb47630ac49eb265082ca1bc0450442f4a83ab947cab` | SIL OFL 1.1 (`OFL-1.1.txt`) |
| `SourceSerif4-Regular.otf` | Static CFF OpenType | `adobe-fonts/source-serif@2823e993c53fca27c5c8749f529b56a5a7c77b6b`, `OTF/SourceSerif4-Regular.otf` | `edf160d0d584deee8a3bb2c3371b2a7624ca63580fbe02c57c1f4c91e84d8787` | SIL OFL 1.1 (`SourceSerif-LICENSE.md`) |
| `RobotoFlex-Variable.ttf` | Variable TrueType | `googlefonts/roboto-flex@7dd9b0b48ef0d2f6001e7f1478184d393cc3e138`, `fonts/RobotoFlex[...].ttf` | `94a7ea95ccee28c54885a507e3cc0a534ce41ec61d413935df0e07261a7ffe63` | SIL OFL 1.1 (`OFL-1.1.txt`) |

## Slice 06 shaping subsets

These deterministic subsets contain only the fixed typography-corpus
codepoints plus required OpenType layout closure. They were made with
fontTools 4.58.2 using `fontTools.subset`, `--layout-features='*'` and
`--name-IDs='*'`. The original Noto family names are intentionally retained so
Fontique/Parley resolution exercises the production path. They are test-only;
no product module imports these files.

| File | Corpus coverage | Upstream source | SHA-256 | License |
|---|---|---|---|---|
| `NotoKufiArabic-Slice06.otf` | Arabic joining: `مرحبا` | `linebender/parley@78de830e4ef1ab6d3558f92d815ca40f2ab98eaf`, `parley_dev/assets/fonts/noto_fonts/NotoKufiArabic-Regular.otf` | `1012bab829f06e0fa5124ae5390fd7b83577d86bb8b5fe461801a5162491c14d` | SIL OFL 1.1 (`OFL-1.1.txt`) |
| `NotoSansHebrew-Slice06.ttf` | Hebrew and mixed bidi: `שלום` | `notofonts/noto-fonts@ffebf8c1ee449e544955a7e813c54f9b73848eac`, `hinted/ttf/NotoSansHebrew/NotoSansHebrew-Regular.ttf` | `26748f2d21d4a3aae5ac7f15b614252419bab4de1f40f0dfb06e0af7ef49a044` | SIL OFL 1.1 (`OFL-1.1.txt`) |
| `NotoSansDevanagari-Slice06.ttf` | Devanagari conjuncts: `नमस्ते` | `notofonts/noto-fonts@ffebf8c1ee449e544955a7e813c54f9b73848eac`, `hinted/ttf/NotoSansDevanagari/NotoSansDevanagari-Regular.ttf` | `8f85ebe78023ceee9baa55237929bbb5d19ee9ee87ba1045c3a1b761eb2f1752` | SIL OFL 1.1 (`OFL-1.1.txt`) |
| `NotoSansThai-Slice06.ttf` | Thai marks: `ภาษาไทย` | `notofonts/noto-fonts@ffebf8c1ee449e544955a7e813c54f9b73848eac`, `hinted/ttf/NotoSansThai/NotoSansThai-Regular.ttf` | `5cbbdb5ecb6dccb6df47917671cf858321de4a44856f4a433141b9f4d7696e91` | SIL OFL 1.1 (`OFL-1.1.txt`) |
| `NotoSansCJKjp-Slice06.otf` | Japanese/Chinese: `日本語中文` | `notofonts/noto-cjk@f8d157532fbfaeda587e826d4cd5b21a49186f7c`, `Sans/OTF/Japanese/NotoSansCJKjp-Regular.otf` | `654e1a6c16955d4b31e6e9d9bb76f4d091b7938b39c8bb7ccadb4a3b5517f104` | SIL OFL 1.1 (`OFL-1.1.txt`) |
| `NotoEmoji-Slice06.ttf` | Emoji surrogate pair: `😀` | `google/fonts@2796410152d4f9524b68ed46e69c1b60f8e0f7c3`, `ofl/notoemoji/NotoEmoji[wght].ttf` | `0a5b5b9318c75fa69304062fc99dcf528db3997fbe360b47cb39e46c988d6c94` | SIL OFL 1.1 (`OFL-1.1.txt`) |

The files were downloaded from the corresponding public GitHub repositories.
Do not replace a fixture without updating its commit, checksum and license.
