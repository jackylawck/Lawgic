# Lawgic 羅輯 (邏輯遊戲 Logic Games)

<p align="center">
  <img src="web-frontend/public/Lawgic192icon.png" width="96" height="96" alt="Lawgic Logo" />
</p>

<p align="center">
  <strong>高精度邏輯推理、空間運算與競技解題平台</strong><br>
  <em>High-Precision Cognitive Logic, Spatial Deduction & Competitive Puzzle Platform</em>
</p>

<p align="center">
  <a href="https://jackylawck.github.io/Lawgic/">🌐 線上即玩 Live Demo</a> •
  <a href="#架構特色-architecture-highlights">架構特色 Highlights</a> •
  <a href="#核心遊戲矩陣-core-game-matrix">遊戲矩陣 Games</a> •
  <a href="#心理測量學與認知維度-psychometrics--chc-model">認知維度 Cognitive Models</a> •
  <a href="#技術架構與極限優化-technical-architecture">技術架構 Architecture</a> •
  <a href="#本地開發-local-development">本地開發 Setup</a>
</p>

---

## 📖 關於本專案 / About This Project

> **這是一個為了給兒子伴隨成長而親手打造的遊戲專案。**  
> 誠邀所有同好一同體驗、參與與交流，願我們都能重拾思維頓悟的純粹樂趣！
>
> *A personal project handcrafted to accompany my son as he grows up.*  
> *Warmly inviting all puzzle enthusiasts to play, explore, and share the pure joy of logical insight!*

---

## 繁體中文介紹

### 平台簡介
**Lawgic 羅輯** 是一款依據世界謎題聯合會（WPF）、世界數獨錦標賽（WSC）與國際智力運動標準打造的現代化純邏輯競賽平台。拒絕無意義的猜題窮舉與套路記憶，平台將 **高效能 Rust/WebAssembly 零拷貝核心**、**前 0.1% 競賽級確定性演算法（Deterministic Procedural Engines）**、**離散圖論約束求解唯一解驗證**、**CHC 心理測量學模型** 與精準觸控互動結合，提供無廣告、無干擾的職業級競技與大腦心流訓練環境。

### 架構特色
* **WASM 零拷貝記憶體與查表常數加速**：核心數獨運算模組全面以 Rust 編寫並編譯為 WebAssembly，具備編譯期預算靜態鄰居查表（LUT）與共享記憶體視圖（Zero-Copy Memory View），實現超低功耗與次毫秒級狀態收斂。
* **零等待啟動 + 漸進時間切片（Time-Sliced Engine）**：首屏啟動 0ms 秒開，背景透過非同步時間切片（Time-Slicing）平滑合成高階題目，徹底杜絕主執行緒掉幀。
* **數學級唯一解證書（Exact Cover Uniqueness Engine）**：拒絕「算力不夠即判定唯一」的偽科學。數獨、數織、多米諾與數橋全面實裝基於 MRV 啟發式回溯剪枝與二分匹配的約束求解器，數學證明解空間基數精確為 1，杜絕多解殘局與超時作弊。
* **圖論咽喉連通性與前向容量擠壓（Deep Topological & Arithmetic Forcing）**：數橋實裝正統 Tarjan $O(V+E)$ 割邊滿配雙橋強制，多米諾引入數值感知二分匹配與行列雙重殘餘容量檢驗；數獨實裝雙向 X-Wing 與全向數對，數織導入二維泛洪反證探針。
* **結構化棋譜反證因果樹（Structured Contradiction Trees）**：反證法不再是黑盒子！在數橋與多米諾中完整輸出「假設前提 ➔ 連鎖演繹 ➔ 容量崩潰/圖分裂死鎖」的對局譜級結構節點，支援前端動態高亮連動。
* **後設認知對抗與心流波浪（Metacognitive Resistance & Cognitive Wave）**：空間迷宮導入質數碎形、雙入口時間黑洞、心智流血量（Visual Regret）與視覺-最優重疊率驗證（$<40\%$），中段難度具備 $\ge 1.45\times$ 嚴格相位增益，徹底打破貪婪直覺與超節點圖論壓縮。
* **空間推理綜合指數（Spatial Composite Index, SCI）**：依據 CHC 認知架構量化「拓撲迴路掌控力（Eulerian Loop Control）」、「平面分割適應力（Planar Partitioning）」與「正交射線覆蓋力（Ray Tracing）」，輸出臨床常模標度分（Scaled 1~19）與個人化弱點訓練建議。
* **神經回饋賽後病理切片（Post-Mortem Analytics）**：賽後不僅記錄成績，更提供「迷宮悔恨熱力圖」、「致命欺騙航點（Deception Waypoints）」高亮檢視、數橋「首度猜測錨點標記」，以及對比「雙軌最優幽靈（Optimal Ghost）」，將解題轉化為自我學習迴路。
* **三階因果提示鏈與自由無猜模式（Causal Hint Ladder & Free Pure-Logic Mode）**：提示依序提供「焦點啟發 ➔ 拓撲因果 ➔ 必然鎖定」；無猜模式解綁機器固定順序，允許選手在當前所有合法強制步驟中自由擇一，兼顧純邏輯與自主心流。
* **WPF 規範賽事模式與零信任防偽簽章（Zero-Trust Receipt）**：一鍵開啟賽事模式，鎖定盤面禁止重新生成與提示，通關後透過 Web Crypto API 原生硬體加速生成 SHA-256 數位簽章與常數時間核驗，確保賽事防偽與成績公信力。
* **全封閉離線 PWA 體驗**：整合具備 1.8 秒超時熔斷保護與 WebAssembly 二進制快取特化之 Service Worker，配合 iOS 動態島與底部 Safe Area 邊界適配，支援手機、平板與桌面端原生全螢幕離線遊玩。

---

### 核心遊戲矩陣 (Core Game Matrix)

| 代號 | 遊戲名稱 | 核心能力維度 (CHC) | 演算法與賽事級特點 |
| :--- | :--- | :--- | :--- |
| `maze` | **空間迷宮** | 空間導航、心智心圖 | 質數動態網格碎形、雙入口時間黑洞、視覺直線性後悔值、雙胞胎地標悖論、重疊率 $<40\%$ 逆向驗證、Boss 二階段精神污染 |
| `sudoku` | **數獨魔陣** | 約束傳播、工作記憶 | Rust/WASM 零拷貝引擎、MRV 位元剪枝、全向 Naked/Hidden Pairs、雙向 X-Wing 魚形定式、純定式 Lookahead-3 演繹反證探針 |
| `nonogram` | **像素數織** | 離散斷面掃描、衝動抑制 | 全向量化 Bitmask DP 單行交集、二維全域泛洪反證、DAG 依賴樹、Master Key 咽喉雪崩、400px 逐行光波斜向綻放、50 步 Undo 堆疊 |
| `dominoes` | **骨牌矩陣** | 二維鋪砌、全域配對覆蓋 | 數值感知二分匹配瓶頸割裂、MRV 前置剪枝無預算作弊、結構化棋譜反證鏈、行列雙重殘餘容量檢驗、邊角優先釘定與 32px 擴展抗干擾熱區 |
| `hashi` | **星際數橋** | 拓撲連通、生成樹度數 | 泊松圓盤四向張力均勻度、真 Tarjan 割邊雙橋暴力美學、前向最大容量擠壓（Max Capacity Fail）吃滿深度反證探針、連續純度光譜、42px 防漂移觸控外圈 |
| `nurikabe` | **暗夜數牆** | 平面連通、圖論割點 | 多聯骨牌自由擴散（面積 1~7）、2×2 黑池紅色脈衝定位、點點候選標記 |
| `skyscraper` | **摩天透視** | 3D 心理旋轉、空間透視 | 4 面邊界視線滿足度即時反饋、立體高度推演 |
| `kropki` | **黑白雙星** | 相鄰差比、數理關係 | 白點連續數（差 1）與黑點倍數（2:1）交叉約束傳播 |
| `slitherlink` | **迴路封閉** | 歐拉迴路、頂點度數約束 | 點網格拖曳畫線、0/3 經典定式推進、子環防早斷檢測 |
| `tents` | **帳篷扎營** | 二分圖匹配、8-鄰域幾何 | 雙向抽屜原理閉鎖器、雙子樹角隅互斥破局器、Kuhn-Munkres 雙射唯一驗證 |
| `lightup` | **燈泡照明** | 視線投射、正交覆蓋 | 射線即時追蹤渲染、燈泡直視相撞警示、暗區聚焦模式 |
| `kakuro` | **數和密碼** | 整數分割、交叉約束 | 靜態分割查詢表（Partition Table）、手動 3×3 筆記、錯誤時間序列分析 |
| `hitori` | **孤島數壹** | 負向排除、2-Edge 連通 | 網絡雙連通度保障、符號替換模式（點陣/圖形）、純推理視覺暫存區 |
| `futoshiki` | **天平不等** | 有向無環圖 (DAG)、傳遞閉包 | 不等式拓撲排序、極值鏈傳播、數值衝突即時定位 |
| `masyu` | **珍珠迴路** | 空間拓撲、正交折角約束 | 隨機自避蜿蜒迴路、貼邊黑白定式、相鄰黑珍珠排斥、CSP 唯一解 |

---

## English Introduction

### Overview
**Lawgic** is a professional-grade competitive logic puzzle platform engineered to the standards of the World Puzzle Federation (WPF), World Sudoku Championship (WSC), and international mental athletics associations. Rejecting brute-force guessing and memory drills, the platform fuses **high-performance WebAssembly kernels**, deterministic procedural generation, CSP uniqueness validation, CHC cognitive models, and precision interaction for an ad-free, pure intellectual experience.

### Architecture Highlights
* **Zero-Copy WASM Core**: Computationally intensive solvers are written in Rust and compiled to WebAssembly, featuring compile-time static lookup tables (PEERS_TABLE) and zero-copy shared array memory mapping.
* **Exact Cover Uniqueness Engine**: Mathematical certainty replacing heuristic timeouts. Sudoku, Nonogram, Dominoes, and Hashi feature exact MRV backtracking solvers and value-constrained bipartite matching proofs ensuring puzzle solution cardinality equals exactly 1.
* **Topological Chokepoints & Arithmetic Squeezing**: Hashi incorporates true Tarjan $O(V+E)$ cut-edge double-bridge enforcement, while Dominoes leverages value-constrained bipartite matching and line-sum dual capacity checks.
* **Structured Contradiction Proof Trees**: Moving beyond opaque solvers to generate chess-like notation: Assumption ➔ Forward Derivation ➔ Capacity/Disconnection Collapse, coupled with dynamic board highlighting.
* **Metacognitive Resistance & Cognitive Waves**: The Maze generator enforces prime-mixed fractal symmetry, bi-entrance deceptive loops, visual confidence regret metrics, and $<40\%$ visual-optimal overlap, backed by strict $\ge 1.45\times$ mid-phase cognitive gains.
* **Neurofeedback Post-Mortem Diagnostics**: Beyond win/loss records, users access post-mortem Regret Heatmaps, clickable Deception Waypoints, first-guess branch anchors in Hashi, and 2x speed Optimal Ghost replays.
* **Pedagogical 3-Tier Hint Ladder & Unbound Pure Mode**: Step-by-step guidance preserving cognitive insight (Observation ➔ Topology/Antichain ➔ Forced Placement), while the pure-logic mode unbinds robotic ordering to allow choosing any valid forced deduction.
* **Zero-Latency Startup & Time-Sliced Pool**: Instant synchronous seed generation on startup, paired with smooth, non-blocking asynchronous time-slicing to build a boundless puzzle reserve.
* **WPF-Standard Tournament Mode & Zero-Trust Verification**: Hard locks board generation and hints during official attempts; generates cryptographic SHA-256 receipts via Web Crypto API with constant-time equality checks.

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
    Gv --> M2["Masyu (拓撲迴路)"]
    Gv --> M3["Nurikabe (平面分割)"]
    Gv --> M4["Light Up (射線投射)"]
    Gv --> M5["Nonogram (斷面掃描 / DAG關鍵深度)"]
    Gv --> M6["Hashi (泊松張力 / Tarjan割邊)"]

    Nq --> N1["Sudoku (交叉排他 / 魚定式)"]
    Nq --> N2["Kakuro (整數分割)"]
    Nq --> N3["Futoshiki (DAG偏序)"]
    Nq --> N4["Dominoes (二分匹配 / 鋪砌全集)"]

    Gwm --> W1["候選數動態保留與筆記"]
    Gwm --> W2["結構化前瞻反證樹沙盒"]
    Gwm --> W3["錯誤類型學與時序監測"]

```

---

## 技術架構與極限優化 / Technical Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│                    Lawgic Presentation Layer                │
│  (React 18 + TailwindCSS + iOS Safe Area + PWA Hardened SW) │
└──────────────┬───────────────────────────────┬──────────────┘
               │                               │
               ▼ (Zero-Copy Pointer)           ▼ (Causal Step Stream)
┌──────────────────────────────┐ ┌────────────────────────────┐
│      WASM Core (Rust)        │ │  Procedural TS Generators  │
│  • Compile-time PEERS LUT    │ │ • Exact Bipartite Matching │
│  • Bitmask MRV Propagation   │ │ • Tarjan Bridge Lowlink    │
│  • O(1) Backtrack Snapshot   │ │ • Metacognitive Wave Engine│
└──────────────┬───────────────┘ └─────────────┬──────────────┘
               │                               │
               └───────────────┬───────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                      Zero-Trust Core                        │
│    Web Crypto SHA-256 Digest  +  Constant-Time Verification │
└─────────────────────────────────────────────────────────────┘

```

---

## 本地開發 / Local Development

### 環境需求 / Prerequisites

* **Node.js**: >= 20.0.0
* **npm**: >= 10.0.0
* **Rust**: >= 1.75.0 (含 `wasm32-unknown-unknown` 目標，若需修改 WASM 核心)
* **wasm-pack**: >= 0.12.0

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
├── core-engine/             # Rust 高性能計算與 WASM 模組 (Sudoku/WASM Kernel)
├── web-frontend/
│   ├── public/              # PWA manifest、安全 Service Worker (sw.js) 與靜態資源
│   ├── src/
│   │   ├── components/      # 15 款遊戲駕駛艙 (Board)、反證因果樹高亮、悔恨熱力圖與互動元件
│   │   ├── engines/         # 競技級演算法 (v8 Maze, v5.5 Nonogram, v6 Dominoes, v4 Hashi 等)
│   │   ├── hooks/           # useLearnerProfile (心理測量指標、SCI、常模對照)
│   │   ├── registry/        # RendererRegistry (動態分發與渲染註冊中心)
│   │   ├── utils/           # Web Crypto 完整性驗證 (integrity.ts)、安全儲存
│   │   ├── wasm/            # 由 wasm-pack 輸出的二進制檔與 TS 介面
│   │   ├── App.tsx          # 主儀表板、非同步時間切片生成與賽事模式路由
│   │   └── main.tsx         # 應用程式入口
└── .github/workflows/       # 具備雙層快取之 GitHub Pages 自動化 CI/CD

```

---

## 授權條款 / License

本專案採用 [MIT License](https://www.google.com/search?q=LICENSE) 授權開放開源社群交流使用。
