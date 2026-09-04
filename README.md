# Lawgic 羅輯・遊戲 (Lawgic Logic Games)

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
**Lawgic 羅輯** 是一款依據世界謎題聯合會（WPF）、Nikoli 與國際智力運動標準打造的現代化邏輯推理平台。拒絕無意義的窮舉與死記硬背，平台將純粹前端確定性演算法（Deterministic Algorithms）、CSP（約束滿足問題）唯一解驗證、CHC 心理測量學模型與精準觸控互動結合，提供無廣告、無干擾的職業級競技與思維訓練環境。

### 架構特色
* **零等待啟動 + 漸進時間切片（Time-Sliced Engine）**：首屏啟動 0ms 秒開，背景透過非同步時間切片（Time-Slicing）平滑合成新題，保持主執行緒極致流暢。
* **純前端演算法與 CSP 唯一解保證**：全題型內建獨立純前端演算法生成器，採用 MRV 啟發式搜尋與約束剪枝，確保每道題均具備嚴格的「數學唯一解」與「無猜測（No-Guess）可推導性」。
* **空間推理綜合指數（Spatial Composite Index, SCI）**：依據 CHC 認知架構量化「拓撲迴路掌控力（Eulerian Loop Control）」、「平面分割適應力（Planar Partitioning）」與「正交射線覆蓋力（Ray Tracing）」，輸出臨床常模標度分（Scaled 1~19）與個人化弱點訓練建議。
* **精準錯誤類型學診斷（Error Typology）**：賽後不僅記錄對錯，更區分「衝動抑制失效（如：Kakuro 重複數字、Dominoes 重複骨牌）」、「工作記憶超載（如：和數偏差、死鎖孤島）」與「局部幾何定式違背」，實現精準賽後覆盤。
* **三階因果提示鏈（Causal Hint Ladder）**：不直接揭曉答案，依序提供「Level 1 焦點啟發 ➔ Level 2 定式邏輯收斂 ➔ Level 3 必然步驟鎖定」，保留完整的認知頓悟（Aha! Moment）。
* **WPF 規範賽事模式與零信任防偽簽章（Zero-Trust Receipt）**：一鍵開啟賽事模式，鎖定盤面禁止重新生成與提示，通關後透過 Web Crypto API 生成 SHA-256 數位簽章，確保賽事防偽與成績核實。
* **離線 PWA 與桌面/行動雙模體驗**：配備 Service Worker 快取更新機制與虛擬雙搖桿支援，手機、平板與桌面端皆可全螢幕沉浸式離線遊玩。

---

### 核心遊戲矩陣 (Core Game Matrix)

| 代號 | 遊戲名稱 | 核心能力維度 (CHC) | 演算法與賽事級特點 |
| :--- | :--- | :--- | :--- |
| `maze` | **空間迷宮** | 空間導航、心智心圖 | 虛擬雙搖桿支援、動態戰霧視距 (Fog of War)、幽靈軌跡重播 |
| `sudoku` | **數獨魔陣** | 約束傳播、工作記憶 | 3×3 候選筆記模式、邏輯鏈覆盤、數值衝突即時定位 |
| `nonogram` | **像素數織** | 離散斷面掃描、衝動抑制 | 邊界極限定式、連續塊邏輯剪枝、雙鍵快速填色與叉叉標記 |
| `nurikabe` | **暗夜數牆** | 平面連通、圖論割點 | 多聯骨牌自由擴散（面積 1~7）、2×2 黑池紅色脈衝定位、點點候選標記 |
| `skyscraper` | **摩天透視** | 3D 心理旋轉、空間透視 | 4 面邊界視線滿足度即時反饋、立體高度推演 |
| `hashi` | **星際數橋** | 拓撲連通、生成樹度數 | 180° 點對稱盤面、正交防交叉剪枝、孤島閉環檢測 |
| `kropki` | **黑白雙星** | 相鄰差比、數理關係 | 白點連續數（差 1）與黑點倍數（2:1）交叉約束傳播 |
| `slitherlink` | **迴路封閉** | 歐拉迴路、頂點度數約束 | 點網格拖曳畫線、0/3 經典定式推進、子環防早斷檢測 |
| `tents` | **帳篷扎營** | 二分圖匹配、8-鄰域幾何 | 樹木 1:1 配對、8 鄰域防相撞即時警示、外側行列配額動態追蹤 |
| `lightup` | **燈泡照明** | 視線投射、正交覆蓋 | 射線即時追蹤渲染、燈泡直視相撞警示、暗區聚焦模式 |
| `kakuro` | **數和密碼** | 整數分割、交叉約束 | 靜態分割查詢表（Partition Table）、手動 3×3 筆記、錯誤時間序列分析 |
| `hitori` | **孤島數壹** | 負向排除、2-Edge 連通 | 網絡雙連通度保障、符號替換模式（點陣/圖形）、純推理視覺暫存區 |
| `futoshiki` | **天平不等** | 有向無環圖 (DAG)、傳遞閉包 | 不等式拓撲排序、極值鏈傳播、數值衝突即時定位 |
| `masyu` | **珍珠迴路** | 空間拓撲、正交折角約束 | 隨機自避蜿蜒迴路、貼邊黑白定式、相鄰黑珍珠排斥、CSP 唯一解 |
| `dominoes` | **骨牌矩陣** | 二維鋪砌、全域配對覆蓋 | 雙 N 骨牌套裝動態生成、全域唯一牌型定式、奇數死鎖檢測、套裝核對清單 |

---

## English Introduction

### Overview
**Lawgic** is a professional-grade competitive logic puzzle platform engineered to the standards of the World Puzzle Federation (WPF), Nikoli, and mental athletics associations. Rejecting brute-force guessing and memory drills, the platform fuses deterministic procedural generation, CSP uniqueness validation, CHC cognitive models, and precision interaction for an ad-free, pure intellectual experience.

### Architecture Highlights
* **Zero-Latency Startup & Time-Sliced Pool**: Instant synchronous seed generation on startup, paired with smooth, non-blocking asynchronous time-slicing to build a boundless puzzle reserve.
* **Client-Side Procedural Generation & CSP Uniqueness**: Features dedicated client-side solvers for every puzzle type. MRV heuristics and constraint pruning guarantee unique mathematical solutions and 100% no-guess deductibility.
* **Spatial Composite Index (SCI)**: Evaluates Eulerian loop closure, planar partitioning, and orthogonal ray covering to generate clinical psychometric scaled scores (1~19) and personalized training drills.
* **Clinical Error Typology Diagnostics**: Distinguishes between inhibitory failures (e.g., duplicated numbers, clashing tiles), working-memory overshoots, and local geometric constraint violations for effective post-game review.
* **Pedagogical 3-Tier Hint Ladder**: Step-by-step guidance preserving cognitive insight: Level 1 Observation ➔ Level 2 Constraint Convergence ➔ Level 3 Forced Cell Placement.
* **WPF-Standard Tournament Mode & Zero-Trust Verification**: Hard locks board generation and hints during official attempts; generates cryptographic SHA-256 receipts via Web Crypto API for anti-tamper scoring.
* **PWA & Mobile-First UX**: Responsive touch controls, virtual dual joysticks, standalone installation, and reliable offline play powered by Service Workers.

---

## 心理測量學與認知維度 / Psychometrics & CHC Model

平台所有題型均錨定 **Cattell-Horn-Carroll (CHC) 認知能力模型**，即時計算動態認知負荷與難度量表：


┌────────────────────────┐
│      Gf (流體推理)      │
│   Fluid Intelligence   │
└───────────┬────────────┘
│
┌───────────────────────┼───────────────────────┐
▼                       ▼                       ▼
┌──────────────┐        ┌──────────────┐        ┌──────────────┐
│  Gv (空間視覺) │        │  Nq (數量推理) │        │ Gwm (工作記憶)│
│Visual-Spatial│        │ Quantitative │        │Working Memory│
└───────┬──────┘        └───────┬──────┘        └───────┬──────┘
│                       │                       │
├─ Maze (心智導航)       ├─ Sudoku (交叉排他)     ├─ 候選數動態保留
├─ Masyu (拓撲迴路)      ├─ Kakuro (整數分割)     ├─ 前瞻路徑模擬
├─ Nurikabe (平面分割)   ├─ Futoshiki (DAG偏序)   └─ 錯誤時序監測
└─ Light Up (射線投射)   └─ Dominoes (鋪砌全集)

---

## 本地開發 / Local Development

### 環境需求 / Prerequisites
* **Node.js**: >= 18.0.0
* **npm**: >= 9.0.0

### 安裝與啟動 / Setup & Run
```bash
# 進入前端目錄 / Navigate to frontend
cd web-frontend

# 安裝相依套件 / Install dependencies
npm install

# 啟動本機開發伺服器 / Start dev server
npm run dev

# 進行生產環境構建與型別檢查 / Production build & type-check
npm run build

專案目錄結構 / Directory Layout
web-frontend/
├── public/                  # 靜態資源、PWA manifest 與 Service Worker (sw.js)
├── src/
│   ├── components/          # 15 款遊戲棋盤 (Board) 與雷達圖、模態視窗組件
│   ├── engines/             # 15 款核心獨立純前端演算法與 CSP 求解器 (Generators)
│   ├── hooks/               # useLearnerProfile (心理測量指標、SCI、常模對照)
│   ├── registry/            # RendererRegistry (動態分發與渲染註冊中心)
│   ├── utils/               # Web Crypto 簽章、安全儲存 (SecureStorage)
│   ├── App.tsx              # 主儀表板、非同步時間切片生成與賽事模式路由
│   └── main.tsx             # 應用入口

授權條款 / License
本專案採用 MIT License 授權開放開源社群交流使用。

