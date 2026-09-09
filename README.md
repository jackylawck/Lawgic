# Lawgic 羅輯 (邏輯遊戲 Logic Games)

---

## 📖 關於本專案 / About This Project

> **這是一個為了給兒子伴隨成長而親手打造的遊戲專案。**  
> 誠邀所有同好一同體驗、參與與交流，願我們都能重拾思維頓悟的純粹樂趣！  
> *A personal project handcrafted to accompany my son as he grows up.*  
> *Warmly inviting all puzzle enthusiasts to play, explore, and share the pure joy of logical insight!*

---

## 繁體中文介紹

### 平台簡介

**Lawgic 羅輯** 是一款依據世界謎題聯合會（WPF）、世界數獨錦標賽（WSC）與國際智力運動規章打造的現代化純邏輯競賽平台。平台徹底摒棄偽難度猜題與盲目窮舉，將 **高效能 Rust/WebAssembly 零拷貝核心**、**離線 SMT/SAT 生成守護進程（Generator Daemon）**、**前 0.1% 錦標賽級確定性生成引擎（Deterministic Procedural Engines）**、**離散圖論約束求解唯一解驗證**、**CHC 心理測量學模型** 與純粹無干擾的賽場級快捷操作融合，提供具備可驗證因果鏈條的職業級大腦心流競技環境。

### 架構特色

* **WASM 零拷貝記憶體與查表常數加速**：核心數獨與密集型運算模組全面以 Rust 編寫並編譯為 WebAssembly，具備編譯期預算靜態鄰居查表（LUT）與共享記憶體視圖（Zero-Copy Memory View），實現超低功耗與次毫秒級狀態收斂。
* **數學級唯一解證書（Exact Cover Uniqueness Engine）**：拒絕「算力不夠即判定唯一」的偽科學。全面實裝 AC-3 弧相容傳播、在軌動態 MRV 啟發式剪枝、12000 節點回溯防護與二分匹配，數學證明解空間基數精確為 1，杜絕多解殘局與超時作弊。
* **純邏輯閉環與因果推導率（100% Pure Deduction Rate & Breakpoint Ratio）**：高難度題目（Master / Legendary / Ultimate）嚴格執行人類邏輯求解鏈模擬，實裝真實邏輯斷點深度比（Breakpoint Ratio $\ge 80\%$），消滅早盤盲猜分支，確保試誤僅沈澱於尾盤收割。
* **真實認知轉折點（$\Delta\text{Domain}$ Entropy Crux & Eureka Moments）**：告別機械式技巧標籤。以每一步手筋造成的「加權候選域熵減量（$\Delta\text{Domain}$）」與「DAG 拓撲影響半徑」精確錨定破局天王山（Crux），動態捕捉交響樂般的頓悟波峰（Eureka Peaks）。
* **WPC 賽場級鍵位與心流防護（Speed-Solving Ergonomics）**：
  * **黑白雙星 (`kropki`)**：標準數獨宮格拓撲、貫穿式負約束微結構細虛線（No-Dot Barrier）、同數戰場十字光環高亮、8ms 觸覺行程微震動反饋、可逆 Auto-Notes 快照避險、20% 分段配速條（Splits Telemetry）。
  * **數和密碼 (`kakuro`)**：跑道局部性解空間、180° 對稱區塊侵蝕黑牆、所見即所填候選條、極限和差集合閉包、真·正交容量閉區間擠壓（Capacity Squeeze）、中盤模 9 數字根同餘剪枝。
  * **黑白分明 (`heyawake`)**：方向鍵/WASD 游標磁吸縮放高亮、二態極速切換（空白 ↔ 填黑）、靜默咽喉割點雷達。
  * **天平不等 (`futoshiki`)**：T9 固定三欄盲打九宮格、雙擊數字鎖定注入模式（Injection Mode）、永久十字瞄準線、一鍵硬切無延遲渦輪模式（Turbo Mode）。
  * **隻眼獨尊 (`hitori`)**：左鍵主決策循環、右鍵紙本鉛筆草稿三態標記（Pencil Marking）、衝突與同數空間波浪底線視覺疊加、即時 APM 戰績追蹤。
  * **燈泡照明 (`lightup`)**：左右鍵瞬發分流（左鍵 💡 / 右鍵 •）、行動端零延遲三態模式鎖定棒（Mode Stick）、50 步環形快照與審計軌跡深度綁定、反向暗區盲點凸顯（Blindspot Highlight）、雙因子空間熱區教練提示（Hot-Zone Hinting）、WPC 鉑金/金牌/銀牌不可逆後置操作審計。
  * **矢印連線 (`yajilin`) & 四角分割 (`shikaku`)**：正交迴路自避檢測、長方形面積幾何動態約束錨定。
* **臨床級反作弊監控與專業監考（Proctoring & Anti-Cheat）**：整合 `useAntiCheatMonitor`、`clinicalProctoring` 與硬體級輸入防漂移偵測，確保錦標賽競技數據的客觀嚴密。
* **嚴格賽事裸裝模式（Strict Tournament Mode）**：開啟賽事模式即強制隱蔽所有即時衝突紅框、波浪輔助線與虛假標稱配額，鎖定盤面禁止提示，還原國際大賽現場的「無輔助裸裝對決」。
* **零信任防偽存證簽章（Zero-Trust Receipt）**：通關後透過 Web Crypto API 原生硬體加速生成 SHA-256 數位簽章與常數時間核驗，確保各項賽事通關憑證與個人最佳紀錄（PB）無法篡改。
* **全封閉離線 PWA 體驗**：整合具備 1.8 秒超時熔斷保護與 WebAssembly 二進制快取特化之 Service Worker，配合 iOS 動態島與底部 Safe Area 邊界適配，支援手機、平板與桌面端全螢幕離線流暢遊玩。

---

### 核心遊戲矩陣 (Core Game Matrix - 18 款正式遊戲)

| 代號 | 遊戲名稱 | 核心能力維度 (CHC) | 演算法與賽事級特點 |
| --- | --- | --- | --- |
| `kropki` | **黑白雙星** | 數理偏序、宮格空間排他 | 正統數獨宮格拓撲（2x2/2x3/3x3）、全相鄰無點負約束（Full Kropki）、雙向 X-Wing 魚形排除、4x 超加權樞紐錨定、真實斷點深度比（$\ge 80\%$）、貫穿虛線屏障、8ms 觸覺行程鍵盤 |
| `kakuro` | **數和密碼** | 整數分割、數論同餘閉包 | 跑道局部性獨立去重、180° 對稱區塊侵蝕黑牆、雙向極限和差集合閉包、真·正交容量閉區間擠壓（Capacity Squeeze）、中盤模 9 數字根同餘剪枝、封閉疊代局部傳播、所見即所填候選條 |
| `maze` | **空間迷宮** | 空間導航、心智心圖 | 質數動態網格碎形、雙入口時間黑洞、視覺直線性後悔值、雙胞胎地標悖論、重疊率 $<40\%$ 逆向驗證、Boss 二階段精神污染 |
| `sudoku` | **數獨魔陣** | 約束傳播、工作記憶 | Rust/WASM 零拷貝引擎、MRV 位元剪枝、全向 Naked/Hidden Pairs、雙向 X-Wing 魚形定式、純定式 Lookahead-3 演繹反證探針 |
| `nonogram` | **像素數織** | 離散斷面掃描、衝動抑制 | 全向量化 Bitmask DP 單行交集、二維全域泛洪反證、DAG 依賴樹、Master Key 咽喉雪崩、400px 逐行光波斜向綻放、50 步 Undo 堆疊 |
| `dominoes` | **骨牌矩陣** | 二維鋪砌、全域配對覆蓋 | 數值感知二分匹配瓶頸割裂、MRV 前置剪枝無預算作弊、結構化棋譜反證鏈、行列雙重殘餘容量檢驗、邊角優先釘定與 32px 擴展抗干擾熱區 |
| `hashi` | **星際數橋** | 拓撲連通、生成樹度數 | 泊松圓盤四向張力均勻度、真 Tarjan 割邊雙橋暴力美學、前向最大容量擠壓（Max Capacity Fail）吃滿深度反證探針、連續純度光譜、42px 防漂移觸控外圈 |
| `heyawake` | **黑白分明** | 拓撲割點、視線射線阻斷 | BSP 互鎖咬合 L-Room 齒輪切割、主動射線閉包傳播（Active Ray Blocker）、真雙分支分歧熵、二態極速切換、咽喉割點雷達、鍵盤磁吸鎖定 |
| `futoshiki` | **天平不等** | 有向無環圖 (DAG)、傳遞閉包 | Knuth 無偏真隨機拉丁方、全量 Naked Pair 雙格數對引擎、Floyd-Warshall 矩陣全域複用、中局平行分支度（$\ge 2.4$）、雙擊鎖定注入模式、殘局調度加速 |
| `hitori` | **隻眼獨尊** | 負向排除、候選域熵減 | 視覺優先手筋層（三連全推導/三明治）、計數白黑雙向閉環、防碰撞批量塗黑、$\Delta\text{Domain}$ 加權熵減 Crux、紙本鉛筆草稿系統、50ms 極速熔斷 |
| `yajilin` | **矢印連線** | 正交迴路、射線指向計數 | 閉合迴路自避檢驗、箭頭射線黑格拓撲遮蔽、相鄰黑格互斥判定、角落單元閉鎖剪枝 |
| `shikaku` | **四角分割** | 幾何整除、矩形空間鋪砌 | 質因數矩形分解列舉、數字包含唯一性約束、多矩形衝突割平面演算法、非重疊平面覆蓋驗證 |
| `nurikabe` | **暗夜數牆** | 平面連通、圖論割點 | 多聯骨牌自由擴散（面積 1~7）、2×2 黑池紅色脈衝定位、點點候選標記 |
| `skyscraper` | **摩天透視** | 3D 心理旋轉、空間透視 | 4 面邊界視線滿足度即時反饋、立體高度推演 |
| `slitherlink` | **迴路封閉** | 歐拉迴路、頂點度數約束 | 點網格拖曳畫線、0/3 經典定式推進、子環防早斷檢測 |
| `tents` | **帳篷扎營** | 二分圖匹配、8-鄰域幾何 | 雙向抽屜原理閉鎖器、雙子樹角隅互斥破局器、Kuhn-Munkres 雙射唯一驗證 |
| `lightup` | **燈泡照明** | 視線投射、全域命題邏輯 | 偽布林（PB）基數不等式邊界收緊、全域 2-SAT Kosaraju SCC 蘊含圖傳播、雙向對稱歸謬探針（±Reductio）、動態美學拓撲（低階連通長城 / 高階孤島光阱）、頓悟峰值（Eureka Moments）心流計量、左鍵燈泡/右鍵防護點雙模極速落子、零延遲行動端模式鎖定棒（Mode Stick）、WPC 鉑金級無試錯實操審計 |
| `masyu` | **珍珠迴路** | 空間拓撲、正交折角約束 | 隨機自避蜿蜒迴路、貼邊黑白定式、相鄰黑珍珠排斥、CSP 唯一解 |

---

## English Introduction

### Overview

**Lawgic** is a professional-grade competitive logic puzzle platform engineered to the standards of the World Puzzle Federation (WPF), World Sudoku Championship (WSC), and international mental athletics associations. Rejecting brute-force guessing and memory drills, the platform fuses **high-performance WebAssembly kernels**, deterministic procedural generation, SMT-welded puzzle daemons, CSP uniqueness validation, CHC cognitive models, and precision interaction for an ad-free, pure intellectual experience.

### Architecture Highlights

* **Zero-Copy WASM Core**: Computationally intensive solvers are written in Rust and compiled to WebAssembly, featuring compile-time static lookup tables (PEERS_TABLE) and zero-copy shared array memory mapping.
* **Exact Cover Uniqueness Engine**: Mathematical certainty replacing heuristic timeouts. Across Sudoku, Nonogram, Dominoes, Hashi, Heyawake, Futoshiki, Hitori, Kakuro, Kropki, Light Up, Yajilin, and Shikaku, exact MRV backtracking solvers and value-constrained bipartite matching proofs guarantee puzzle solution cardinality equals exactly 1.
* **100% Pure Deduction Rate & Breakpoint Ratio**: Master, Legendary, and Ultimate tiers strictly enforce complete human deductive chain simulations with Breakpoint Depth Ratio $\ge 80\%$, discarding puzzles requiring trial-and-error branching during early and mid games.
* **True Cognitive Crux via $\Delta\text{Domain}$ Reduction**: Crux points are quantified using weighted candidate domain entropy reductions and DAG topological radii rather than arbitrary heuristic weights.
* **Speed-Solving Ergonomics**:
  * **Kropki**: Standard box topology, linear dashed negative-constraint barriers, localized crosshair highlight, 8ms mechanical haptic feedback, reversible auto-notes infill, 20% pace splits.
  * **Kakuro**: Run-local solution spaces, blocky 180° erosion layout, clickable candidate strip, extreme sum set-closures, cross-capacity squeeze, deep modulo-9 digital root congruence filters.
  * **Heyawake**: WASD/Arrow magnetic cursor scaling, dual-state speed toggle (Blank ↔ Black), silent cut-point radar.
  * **Futoshiki**: Fixed 3-column numpad, double-click number injection mode, permanent crosshair guide, zero-latency Turbo Mode.
  * **Hitori**: Primary click cycle, secondary pencil-marking (Pencil Marks), real-time action & APM metric tracker.
  * **Light Up**: Dual-mode left/right instantaneous dispatch (Left: Light, Right: Dot), zero-latency Mobile Mode Stick, 50-step circular snapshot stack, inverted darkness focus, dual-factor hot-zone hinting, immutable Grandmaster Platinum post-audit.
  * **Yajilin & Shikaku**: Closed self-avoiding loop detection, dynamic geometric factoring for rectangular tiling.
* **Clinical Proctoring & Integrity Monitoring**: Integrates `useAntiCheatMonitor`, `clinicalProctoring`, and hardware input drift heuristics to ensure objective competitive fidelity.
* **Strict Tournament Mode**: Completely suppresses in-game conflict glows, wave overlays, and nominal quota labels for unassisted, competition-compliant solving.
* **Zero-Trust Verification**: Hard locks board generation and hints during official attempts; generates cryptographic SHA-256 receipts via Web Crypto API with constant-time equality checks.

---

## 心理測量學與認知維度 / Psychometrics & CHC Model

平台所有題型均錨定 **Cattell-Horn-Carroll (CHC) 認知能力模型**，即時計算動態認知負荷與難度量表：

```mermaid
flowchart TD
    Gf["🧠 Gf (流體推理 / Fluid Intelligence)"]

    Gf --> Gv["🧭 Gv (空間視覺 / Visual-Spatial)"]
    Gf --> Nq["🔢 Nq (數量推理 / Quantitative)"]
    Gf --> Gwm["⚡ Gwm (工作記憶 / Working Memory)"]

    Gv --> M1["Maze (心智導航 / 拓撲避障)"]
    Gv --> M2["Masyu / Slitherlink (拓撲封閉迴路)"]
    Gv --> M3["Nurikabe (平面分割)"]
    Gv --> M4["Light Up (雙向射線 / 2-SAT 全域覆蓋) / Skyscraper (透視推演)"]
    Gv --> M5["Nonogram (斷面掃描 / DAG關鍵深度)"]
    Gv --> M6["Hashi (泊松張力 / Tarjan割邊)"]
    Gv --> M7["Heyawake (L-Room咬合 / 射線閉包)"]
    Gv --> M8["Yajilin (方向線索 / 迴路避障)"]
    Gv --> M9["Shikaku (幾何分割 / 矩形覆蓋)"]

    Nq --> N1["Sudoku (交叉排他 / 魚定式)"]
    Nq --> N2["Kakuro (跑道局部性 / 數論模9同餘)"]
    Nq --> N3["Futoshiki (無偏拉丁方 / 數對鎖定)"]
    Nq --> N4["Dominoes (二分匹配 / 鋪砌全集)"]
    Nq --> N5["Hitori (視覺手筋優先 / 雙向計數強制)"]
    Nq --> N6["Kropki (宮格拓撲 / 全負約束 / 雙向魚)"]

    Gwm --> W1["候選數動態保留與鉛筆筆記 (Pencil Marks)"]
    Gwm --> W2["結構化前瞻反證樹沙盒"]
    Gwm --> W3["錯誤類型學與即時 APM 時序監測"]

```

---

## 技術架構與極限優化 / Technical Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│                     Lawgic Presentation Layer               │
│  (React 18 + TailwindCSS + iOS Safe Area + PWA Hardened SW) │
└──────────────┬───────────────────────────────┬──────────────┘
               │                               │
               ▼ (Zero-Copy Pointer)           ▼ (Causal Step Stream)
┌──────────────────────────────┐ ┌────────────────────────────┐
│      WASM Core (Rust)        │ │  Procedural TS Generators  │
│  • Compile-time PEERS LUT    │ │ • Full Kropki Box Topology │
│  • Bitmask MRV Propagation   │ │ • Run-Local Modulo-9 Sieve │
│  • O(1) Backtrack Snapshot   │ │ • 2-SAT Kosaraju SCC Blk   │
└──────────────┬───────────────┘ └─────────────┬──────────────┘
               │                               │
               └───────────────┬───────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                    Clinical Integrity Layer                 │
│  Anti-Cheat Monitor + SMT Welder + Web Crypto SHA-256 Auth  │
└─────────────────────────────────────────────────────────────┘

```

---

## 本地開發 / Local Development

### 環境需求 / Prerequisites

* **Node.js**: >= 20.0.0
* **npm**: >= 10.0.0
* **Rust**: >= 1.75.0 (含 `wasm32-unknown-unknown` 目標，若需修改 WASM 核心)
* **wasm-pack**: >= 0.12.0
* **Python**: >= 3.10 (若需使用 `generator_daemon/` 批量生產種子庫)

### 安裝與啟動 / Setup & Run

```bash
# 1. 進入前端目錄 / Navigate to frontend
cd web-frontend

# 2. 確定性安裝相依套件 / Install dependencies
npm ci

# 3. 啟動本機開發伺服器 / Start dev server
npm run dev

# 4. 進行嚴格型別檢查與生產打包 / Production build & type-check
npm run build

```

### 構建 WebAssembly 核心 (可選) / Build WASM Core (Optional)

```bash
# 進入 Rust 核心引擎目錄 / Navigate to core engine
cd core-engine

# 編譯並優化 WASM 產物至前端目錄 / Build & optimize WASM
wasm-pack build --target web --release --out-dir ../web-frontend/src/wasm
rm -f ../web-frontend/src/wasm/.gitignore

```

### 專案目錄結構 / Directory Layout

```text
Lawgic/
├── .github/workflows/       # 具備雙層快取之 GitHub Pages 自動化 CI/CD (deploy.yml)
├── core-engine/             # Rust 高性能計算與 WASM 模組 (Sudoku/WASM Kernel)
│   ├── Cargo.toml
│   └── src/lib.rs
├── generator_daemon/        # 離線題目工廠與 SMT 求解器守護進程 (Python)
│   ├── batch_factory.py
│   ├── maze_generator.py
│   └── smt_welder.py
├── web-frontend/
│   ├── public/              # PWA manifest、安全 Service Worker (sw.js) 與靜態圖示
│   ├── src/
│   │   ├── components/      # 18 款競速駕駛艙 (Board)、因果高亮、虛擬手把與互動元件
│   │   ├── contexts/        # 語系切換 (LanguageContext) 與無障礙支援 (AccessibilityContext)
│   │   ├── engines/         # 18 款競技級演算法 (Kropki Apex, LightUp 2-SAT WPC, Heyawake V6 等)
│   │   ├── generated/       # 靜態種子庫與題目元數據預編譯快取 (JSON)
│   │   ├── hooks/           # useLearnerProfile、useAntiCheatMonitor、useLongTermScheduler
│   │   ├── registry/        # RendererRegistry (動態分發與容錯重試註冊中心)
│   │   ├── utils/           # 臨床監考、動態常模、密碼學簽章、金庫存儲與排行榜
│   │   ├── App.tsx          # 主儀表板、非同步時間切片生成與賽事模式路由
│   │   └── main.tsx         # 應用程式入口
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts
├── GOVERNANCE_AND_COMPLIANCE.md # 合規性審計與資料治理政策聲明
├── LICENSE                  # MIT 授權條款
└── README.md                # 專案說明文件

```

---

## 授權條款 / License

本專案採用 [MIT License](https://www.google.com/search?q=LICENSE) 授權開放開源社群交流使用。
