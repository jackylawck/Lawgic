# Lawgic 羅輯 (Logic Games & Cognitive Matrix)

<div align="center">

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![CI/CD Build](https://img.shields.io/badge/Build-Passing-brightgreen.svg)](https://github.com/your-username/lawgic/actions)
[![Rust 1.75+](https://img.shields.io/badge/Rust-1.75+-orange.svg)](https://www.rust-lang.org/)
[![PWA Ready](https://img.shields.io/badge/PWA-Hardened-emerald.svg)](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps)
[![WSC/WPF Compliant](https://img.shields.io/badge/Standard-WPF%20%2F%20WSC-purple.svg)](https://www.worldpuzzle.org/)

**純邏輯・無猜測・競賽級開源益智遊戲與認知科學評測矩陣**  
*A Pure-Deduction, Tournament-Grade Logic Puzzle Engine & Psychometric Framework.*

[🚀 立即在線體驗 Demo](https://lawgic.vercel.app/) (支援 PWA 離線遊玩) · [📖 提交 Bug / 反饋建議](https://github.com/your-username/lawgic/issues) · [🤝 參與貢獻](#-參與貢獻-contributing)

</div>

---

## 📖 關於本專案 / About This Project

> **這是一個為了給兒子伴隨成長而親手打造的遊戲專案。**  
> 願我們都能擺脫無效的刷題與盲目猜測，重拾純粹因果演繹的思維頓悟之美！  
> *A personal project handcrafted to accompany my son as he grows up.*  
> *Dedicated to rediscovering the pure joy of deductive insight without guesswork.*

---

## 👨‍👦 伴讀心智圖譜與成長階梯 / Pedagogical Roadmap

本專案依據皮亞傑認知發展階段論（Piaget's Theory）與 CHC 智力理論體系，為孩子思維躍遷量身打造長期成長階梯：

```text
  [Kids: 具體運思期啟蒙] (6~8歲)
  └── 核心聚焦點：幾何邊界直覺、空間對稱、不相鄰排斥 (Maze, Tents, Shikaku, Light Up)
       └── 認知里程碑：建立空間邊界感、守恆概念、抗挫力與手眼微動作協調。

  [Intermediate / Expert: 抽象邏輯過渡] (9~12歲)
  └── 核心聚焦點：奇偶守恆、雙向鏈條、局部容斥原理 (Slitherlink, Skyscraper, Kropki, Futoshiki)
       └── 認知里程碑：徹底擺脫盲目試誤，養成「因果可溯」的演繹習慣，拓寬工作記憶跨度。

  [Master / Legendary / Ultimate: 形式運思與競賽殿堂] (13歲以上 & 終身學習)
  └── 核心聚焦點：2-SAT 蘊含圖、高階魚族 (Swordfish/Exocet)、反證矛盾閉合、動態熵減 (Sudoku, Yajilin, Nurikabe)
       └── 認知里程碑：前額葉高階元認知（Meta-Cognition）成熟，具備直面 WPC/WSC 世界錦標賽的純邏輯直覺。

⚡ 核心架構亮點 (Highlights)
 * 100% 純演繹保證 (No-Guessing Guaranteed)：每道題目經由離散圖論與 SMT 求解器嚴格審定，解空間基數精確為 1，前中盤絕無盲猜分支。
 * 零拷貝 WASM 引擎：計算密集型核心由 Rust 編寫並編譯為 WebAssembly，具備靜態鄰居查表（LUT）與共享記憶體視圖，按鍵響應延遲低於 5ms。
 * 神經反應級操作手感：支援 Vim 主鍵位盲打、拖曳防斜滑熔斷（Drag-to-Draw）、無文字彈窗之原位 2.5px 震盪防護，落子反應零眼動脫鉤。
 * 完全無干擾與零追蹤：無廣告、無代幣、無第三方追蹤代碼，支援完整的 Service Worker 離線 PWA 快取。
🕹️ 遊戲快速索引 (Game Index)
點擊任意遊戲名稱直接跳轉至對應規格欄位：
> 🔢 數獨魔陣 · ➕ 數和密碼 · ⚪ 黑白雙星 · ⚖️ 天平不等 · 👁️ 隻眼獨尊
> ➰ 迴路封閉 · 🏹 矢印連線 · ⚪ 珍珠迴路 · 🧱 暗夜數牆 · 🌉 星際數橋 · 🌀 空間迷宮
> 🏙️ 摩天透視 · 💡 燈泡照明 · 🔲 四角分割 · 🚪 黑白分明
> ⛺ 帳篷扎營 · 🀄 骨牌矩陣 · 🎨 像素數織
> 
🧩 核心遊戲矩陣 (Core Matrix)
系統依據計算機科學底層問題域與 Cattell-Horn-Carroll (CHC) 認知模型雙維度分類。表格內所有標籤皆支援點擊直達底層演算法定義。
1. 精確覆蓋與約束求解 (Exact Cover & CSP)
> 核心認知：數量推理 (N_q)、工作記憶 (G_{wm})
> 
| 代號 | 遊戲名稱 | 一句話玩法 (15字內) | 核心技術標籤 | 變體 / 賽事特點 |
|---|---|---|---|---|
| <span id="sudoku-數獨魔陣">sudoku</span> | 數獨魔陣 | 填入數字確保行列宮不重複 | #DLX #AC-3 #BDCE-v9.1 | <details><summary>展開 8 種變體說明</summary>原生支援 Killer, Diagonal, OddEven, Window, Consecutive, Arrow, ExtraRegion, Percent 骨架回填與同構置換。</details> |
| <span id="kakuro-數和密碼">kakuro</span> | 數和密碼 | 交叉數和分解填入不重複數字 | #整數分割 #模9同餘 #容量擠壓 | 180° 對稱黑牆侵蝕佈局、極限和差集合閉包 |
| <span id="kropki-黑白雙星">kropki</span> | 黑白雙星 | 依黑白圓點連續與倍數約束填數 | #宮格拓撲 #全負約束 #魚形排除 | Full Kropki 全無點負向約束、貫穿細虛線屏障 |
| <span id="futoshiki-天平不等">futoshiki</span> | 天平不等 | 依照不等號限制完成拉丁方陣 | #DAG拓撲 #FloydWarshall #雙格數對 | 數對鎖定注入模式 (Injection Mode)、無偏拉丁方 |
| <span id="hitori-隻眼獨尊">hitori</span> | 隻眼獨尊 | 塗黑多餘數字使各行列無重複 | #負向排除 #連鎖塗黑 #ΔDomain | 紙本鉛筆三態草稿系統、50ms 極速無解熔斷 |
2. 平面拓撲與閉合迴路 (Topology & Pathfinding)
> 核心認知：空間視覺 (G_v)、流體推理 (G_f)
> 
| 代號 | 遊戲名稱 | 一句話玩法 (15字內) | 核心技術標籤 | 賽事級特點 |
|---|---|---|---|---|
| <span id="slitherlink-迴路封閉">slitherlink</span> | 迴路封閉 | 點間畫線圍繞數字連成單一環 | #Beam-3_BFS #拓撲割集 #Shannon熵 | 7 步認知極限波束反證、雙態飢餓死鎖雷達、Zen 模式 |
| <span id="yajilin-矢印連線">yajilin</span> | 矢印連線 | 避開障礙與箭頭計數連成單一環 | #三層認知求解 #EMD擬合 #光學互斥 | 拖曳狀態機、3×3 局部衝突防誤殺、大師心理錨點 |
| <span id="masyu-珍珠迴路">masyu</span> | 珍珠迴路 | 黑白珍珠折角與直行約束穿線 | #自避迴路 #折角定式 #CSP驗證 | 貼邊相鄰黑珍珠排斥剪枝、邊界切向防自交閉合 |
| <span id="nurikabe-暗夜數牆">nurikabe</span> | 暗夜數牆 | 填黑格劃分島嶼且黑格全相連 | #多源形態發生 #雙割點過濾 #CP-Solver | 時間軸違規跳轉書籤、純邊框 HUD、思考密度計量 |
| <span id="hashi-星際數橋">hashi</span> | 星際數橋 | 島嶼間架設雙向橋樑連成一體 | #泊松張力 #Tarjan割邊 #容量閉包 | 42px 防漂移觸控外圈、真雙橋割邊拓撲分析 |
| <span id="maze-空間迷宮">maze</span> | 空間迷宮 | 從起點尋路至終點避開死胡同 | #碎形網格 #反向重疊率 #拓撲死鎖 | 雙入口時間黑洞、雙胞胎地標悖論、重疊率逆向校驗 |
3. 空間幾何與光學投射 (Geometry & Ray-Casting)
> 核心認知：3D 心理旋轉 (G_v)、命題邏輯 (G_f)
> 
| 代號 | 遊戲名稱 | 一句話玩法 (15字內) | 核心技術標籤 | 賽事級特點 |
|---|---|---|---|---|
| <span id="skyscraper-摩天透視">skyscraper</span> | 摩天透視 | 依邊緣可見大樓數填寫各樓高 | #Line-CSP #Derivation_DAG #Crux天王山 | 無模態動態長按、Vim 盲打、預測射線、三幕式節奏標尺 |
| <span id="lightup-燈泡照明">lightup</span> | 燈泡照明 | 放置燈泡照亮全盤且互不照射 | #2-SAT #Kosaraju_SCC #歸謬探針 | 偽布林邊界收緊、動態孤島光阱拓撲、行動端 Mode Stick |
| <span id="shikaku-四角分割">shikaku</span> | 四角分割 | 依數字面積劃分不重疊之矩形 | #頂點奇偶性 #因果張量場 #向心退火 | 雙擊向心退火、純觸覺震動引力波脈衝解碼 |
| <span id="heyawake-黑白分明">heyawake</span> | 黑白分明 | 房間內填黑格阻斷長距離視線 | #BSP咬合 #射線阻斷傳播 #分歧熵 | 靜默咽喉割點雷達、二態極速切換、WASD 磁吸鎖定 |
4. 組合優化與資訊度量 (Optimization & Information Theory)
> 核心認知：二分同調 (G_f)、離散空間覆蓋 (G_v)
> 
| 代號 | 遊戲名稱 | 一句話玩法 (15字內) | 核心技術標籤 | 賽事級特點 |
|---|---|---|---|---|
| <span id="tents-帳篷扎營">tents</span> | 帳篷扎營 | 樹旁搭帳篷，正交不連且配額等 | #二分圖同調 #奇偶交錯環 #CriticallyMinimal | 前瞻因果漣漪、自由墨跡、阻尼相位鎖、WPF 連號 Key |
| <span id="dominoes-骨牌矩陣">dominoes</span> | 骨牌矩陣 | 將網格無重疊完整劃分為骨牌集 | #二分匹配 #MRV前置剪枝 #殘餘容量 | 邊角優先釘定、結構化反證鏈、32px 擴展防干擾熱區 |
| <span id="nonogram-像素數織">nonogram</span> | 像素數織 | 依行列連續數字組拼繪出圖案 | #Bitmask_DP #DAG依賴樹 #咽喉雪崩 | 向量單行交集、400px 斜向光波綻放、50 步 Undo 堆疊 |
心理測量學與認知維度 / Psychometrics & CHC Model
平台所有題型均錨定 Cattell-Horn-Carroll (CHC) 認知能力模型，即時計算動態認知負荷與難度量表：
flowchart TD
    Gf["🧠 Gf (流體推理 / Fluid Intelligence)"]

    Gf --> Gv["🧭 Gv (空間視覺 / Visual-Spatial)"]
    Gf --> Nq["🔢 Nq (數量推理 / Quantitative)"]
    Gf --> Gwm["⚡ Gwm (工作記憶 / Working Memory)"]

    Gv --> M1["Maze (心智導航 / 拓撲避障)"]
    Gv --> M2["Slitherlink / Masyu (拓撲封閉迴路 / 對角雙2幾何排斥 / 空間Shannon熵)"]
    Gv --> M3["Nurikabe (雙割點拓撲奇點 / 多源形態發生 / 平面連通)"]
    Gv --> M4["Light Up (雙向射線 / 2-SAT 全域覆蓋)"]
    Gv --> M5["Skyscraper (3D 視線遮擋 / 空間透視推演)"]
    Gv --> M6["Nonogram (斷面掃描 / DAG關鍵深度)"]
    Gv --> M7["Hashi (泊松張力 / Tarjan割邊)"]
    Gv --> M8["Heyawake (L-Room咬合 / 射線閉包)"]
    Gv --> M9["Yajilin (三層認知演繹 / 雙向邊拓撲原子化 / 尺度感知光學互斥 / 3x3 局部衝突過濾)"]
    Gv --> M10["Shikaku (互鎖拓撲 / 邊界頂點奇偶 / 因果張量質量)"]
    Gv --> M11["Tents (二分圖交錯環 / 瞬態對比拉伸 / 前瞻因果向量鏈)"]

    Nq --> N1["Sudoku (雙向認知共振 / 反向致命悖論 UR / 集合覆蓋 A* AIC / Junior Exocet 異魚投影)"]
    Nq --> N2["Kakuro (跑道局部性 / 數論模9同餘)"]
    Nq --> N3["Futoshiki (無偏拉丁方 / 數對鎖定)"]
    Nq --> N4["Dominoes (二分匹配 / 鋪砌全集)"]
    Nq --> N5["Hitori (視覺手筋優先 / 雙向計數強制)"]
    Nq --> N6["Kropki (宮格拓撲 / 全負約束 / 雙向魚)"]

    Gwm --> W1["候選數動態保留與鉛筆筆記 (Pencil Marks)"]
    Gwm --> W2["結構化前瞻反證樹沙盒"]
    Gwm --> W3["錯誤類型學與即時 APM 時序監測"]
    Gwm --> W4["無級時間軸滑塊與歷史分支回溯 (Timeline Scrubber)"]
    Gwm --> W5["雙軌思考密度計量 (Density of Thought)"]
    Gwm --> W6["Shikaku 觸覺震動引力波解碼 (Haptic Telemetry Recall)"]
    Gwm --> W7["Skyscraper (Cowan 4-Chunk 依賴鏈 / 格式塔模塊壓縮 / 實時節奏標尺)"]
    Gwm --> W8["Slitherlink (7步人類認知極限波束反證 / 雙態飢餓死鎖預警 / 轉折點追蹤)"]
    Gwm --> W9["Sudoku (Miller 7±2 認知波束動態衰竭 / 次視覺化 Auto-Candidates 潛意識讀取)"]
    Gwm --> W10["Tents (Shift滾輪平行宇宙幽靈差分 / Alt自由墨跡 / 思維心搏環繞偵測)"]
    Gwm --> W11["Yajilin (指尖神經拖曳狀態機 / 對角瞬態熔斷重錨 / 原位 2.5px 震盪零眼動脫鉤)"]

🛠️ 本地開發與構建 (Development & Build)
環境需求 / Prerequisites
 * Node.js: >= 20.0.0
 * npm: >= 10.0.0
 * Rust: >= 1.75.0 (含 wasm32-unknown-unknown 目標，若需重新編譯 WASM 核心)
 * wasm-pack: >= 0.12.0
 * Python: >= 3.10 (若需使用 generator_daemon/ 批量離線鍛造種子庫)
快速開始 / Quick Start
# 1. 複製專案庫
git clone [https://github.com/your-username/lawgic.git](https://github.com/your-username/lawgic.git)
cd lawgic/web-frontend

# 2. 確定性安裝前端相依套件
npm ci

# 3. 啟動本地開發熱重載伺服器 (預設運行於 http://localhost:5173)
npm run dev

# 4. 執行嚴格 TypeScript 型別檢查與生產打包
npm run build

構建 WebAssembly 核心 (可選)
# 進入 Rust 核心引擎目錄
cd core-engine

# 編譯並優化 WASM 產物至前端目錄
wasm-pack build --target web --release --out-dir ../web-frontend/src/wasm
rm -f ../web-frontend/src/wasm/.gitignore

測試與質量保障 (Testing & Quality)
專案全面採用 Vitest 針對生成器、求解器與演繹純度進行自動化驗證：
# 執行約束滿足器與解法唯一性測試
npm run test

# 監控模式並輸出測試覆蓋率報告
npm run test:coverage

📚 專業術語表 (Glossary)
點擊詞條左側標籤可查閱定義，亦可透過右側 [↑ 回到矩陣] 快速返回：
| 標籤錨點 | 術語 / 縮寫 | 全稱與定義 |
|---|---|---|
| <span id="glossary-csp">#CSP</span> | Constraint Satisfaction Problem | 約束滿足問題：在一組離散變量及限定條件下尋找完全相容的解。平台用其確保解空間嚴格為 1。 ↑ 回到矩陣 |
| <span id="glossary-dlx">#DLX</span> | Dancing Links (Algorithm X) | Donald Knuth 提出的雙向十字鏈表演算法，以常數時間刪除/復原節點，極速求解精確覆蓋（Exact Cover）。 ↑ 回到矩陣 |
| <span id="glossary-ac3">#AC-3</span> | Arc Consistency Algorithm #3 | 經典弧相容演算法：在搜索前沿預先剔除不相容候選值，將搜索樹幾何級剪枝。 ↑ 回到矩陣 |
| <span id="glossary-mrv">#MRV</span> | Minimum Remaining Values | 最少剩餘值優先：啟發式策略，優先對「候選數最少」的格子賦值，使矛盾儘早暴露。 ↑ 回到矩陣 |
| <span id="glossary-bdce">#BDCE-v9.1</span> | Bi-Directional Cognitive Engine | 雙向認知共振引擎：專案自研數獨引擎。正向運行 A* AIC 集合覆蓋，反向預判致命矩形 (UR) 與 BUG+1 破局。 ↑ 回到矩陣 |
| <span id="glossary-2sat">#2-SAT</span> | 2-Satisfiability | 每個子句僅含兩個文字的布爾滿足性問題。藉由建構蘊含圖並尋找強連通分量（SCC），在線性時間內判定可滿足性。 ↑ 回到矩陣 |
| <span id="glossary-kosaraju">#Kosaraju_SCC</span> | Kosaraju's Algorithm | 兩次深度優先搜尋（DFS）求有向圖強連通分量的經典演算法，用於 2-SAT 矛盾環路偵測。 ↑ 回到矩陣 |
| <span id="glossary-crux">#Crux天王山</span> | The Crux Metric | 破局天王山張力：衡量題盤中引爆候選數崩塌、難度驟降的關鍵手筋點（\Delta\text{Domain} 與 DAG 半徑峰值）。 ↑ 回到矩陣 |
| <span id="glossary-emd">#EMD擬合</span> | Earth Mover's Distance | 推土機距離（Wasserstein 度量）：衡量實際推理深度直方圖與 WPC 錦標賽黃金曲線的形態偏差。 ↑ 回到矩陣 |
| <span id="glossary-3tier-solver">#三層認知求解</span> | 3-Tier Cognitive Solver | 類人三層推理架構：嚴格依據 L1（基礎定式）➔ L2（度數拓撲守恆）➔ L3（有限步雙向反證）推進，確保無猜測。 ↑ 回到矩陣 |
| <span id="glossary-optical-repulsion">#光學互斥</span> | Optical Repulsion Physics | 排印物理學：動態評估印刷字距與射線垂直對穿（Crosshair Overlap），消滅快速眼動掃視下的空間視錯覺。 ↑ 回到矩陣 |
| <span id="glossary-dag">#DAG拓撲</span> | Directed Acyclic Graph | 有向無環圖：描述題目演繹因果順序的依賴拓撲，保證每一步推導皆有唯一確定的前提節點。 ↑ 回到矩陣 |
| <span id="glossary-line-csp">#Line-CSP</span> | Line Constraint Propagation | 針對單一行列視線遮擋的專門 CSP 排列求解器，用於摩天樓題型常數時間內的可能序列投影。 ↑ 回到矩陣 |
| <span id="glossary-beam-bfs">#Beam-3_BFS</span> | Human-Bounded Beam Search | 寬度受限為 3、深度限制在 7 步內的廣度優先搜尋，精確模擬人類短期工作記憶極限。 ↑ 回到矩陣 |
| <span id="glossary-shannon-entropy">#Shannon熵</span> | Spatial Shannon Entropy | 資訊熵指標，衡量盤面線索與推導步數在四個象限的分佈平衡度，杜絕局部「邏輯荒漠」。 ↑ 回到矩陣 |
| <span id="glossary-critically-minimal">#CriticallyMinimal</span> | Irreducible Minimality | 不可約極小化：數學證明若從題盤中刪除任意一條線索或符號，題目將瞬間退化為多解或無解。 ↑ 回到矩陣 |
| <span id="glossary-delta-domain">#ΔDomain</span> | Weighted Domain Reduction | 衡量某一手筋執行後全盤候選數集合縮減的加權絕對值，直接映射大腦頓悟（Eureka）強度。 ↑ 回到矩陣 |
| <span id="glossary-tarjan">#Tarjan割邊</span> | Tarjan's Bridge-Finding Algorithm | 線性時間偵測無向圖中割邊（Bridges）的演算法，用於防範迴路遊戲提早閉合或通道孤立。 ↑ 回到矩陣 |
| <span id="glossary-vertex-parity">#頂點奇偶性</span> | Boundary Vertex Parity | Shikaku 特化演算法，以矩形角點在邊界節段上的接觸次數判定局部閉合有效性。 ↑ 回到矩陣 |
| <span id="glossary-bipartite-homology">#二分圖同調</span> | Bipartite Parity Loops | 將帳篷與樹木建模為二分圖，透過交錯路徑奇偶校驗在不回溯的前提下導出必然解。 ↑ 回到矩陣 |
| <span id="glossary-bitmask-dp">#Bitmask_DP</span> | Vectorized Bitmask Dynamic Programming | 數織特化技術，利用 64 位元整數運算單元向量化並行比對所有可能排列的交集。 ↑ 回到矩陣 |
| <span id="glossary-bsp">#BSP咬合</span> | Binary Space Partitioning | 二元空間分割技術，用於黑白分明題目生成隨機互鎖的 L-Room 與房間骨架。 ↑ 回到矩陣 |
| <span id="glossary-morphogenesis">#多源形態發生</span> | Morphogenetic Growth | 模擬生物圖樣生長的演算法，用於數牆題目中白島與黑海的動態推演，杜絕過於方正的積木感。 ↑ 回到矩陣 |
| <span id="glossary-dual-cut">#雙割點過濾</span> | Dual-Cut Point Filter | 嚴密圖論過濾器，確保黑海連通時不依賴單一割點（Articulation Point），避免產生非人道狹窄路徑。 ↑ 回到矩陣 |
| <span id="glossary-integer-partition">#整數分割</span> | Integer Partition | 數論問題：將整數分解為給定數量不重複正整數之和，用於數和（Kakuro）預先建立可行解集合。 ↑ 回到矩陣 |
| <span id="glossary-modulo9">#模9同餘</span> | Modulo-9 Digital Root Congruence | 利用十進制數字根特性，在數和深層搜索中常數時間快速剪除不合法組合。 ↑ 回到矩陣 |
| <span id="glossary-capacity-squeeze">#容量擠壓</span> | Cross-Capacity Squeeze | 在多交叉路徑中利用封閉區間交集擠壓剩餘變數取值範圍。 ↑ 回到矩陣 |
| <span id="glossary-box-topology">#宮格拓撲</span> | Sudoku Box Topology | 傳統數獨的九宮格空間劃分，結合偏序線索形成雙重約束場。 ↑ 回到矩陣 |
| <span id="glossary-negative-constraints">#全負約束</span> | Full Negative Constraints | 規則特化：相鄰格若未標示圓點或符號，則其數值絕對不能滿足該關係（如相鄰必不連續）。 ↑ 回到矩陣 |
| <span id="glossary-fish-elimination">#魚形排除</span> | Fish Patterns (X-Wing / Swordfish) | 利用共軛對在網格上形成的封閉矩形或立方投影進行跨行列候選數排除。 ↑ 回到矩陣 |
| <span id="glossary-floyd-warshall">#FloydWarshall</span> | Floyd-Warshall All-Pairs Shortest Path | 用於天平不等題目中求有向圖全對傳遞閉包，即時檢驗不等號鏈條矛盾。 ↑ 回到矩陣 |
| <span id="glossary-naked-pairs">#雙格數對</span> | Naked / Hidden Pairs | 約束傳播基本手筋：同區域內兩格若僅能填入相同兩個數，則該區域其餘格可完全剔除此二數。 ↑ 回到矩陣 |
| <span id="glossary-negative-elimination">#負向排除</span> | Negative Elimination | 透過「若此格留白則相鄰必塗黑」的連鎖矛盾進行的反向剔除。 ↑ 回到矩陣 |
| <span id="glossary-cascade-shading">#連鎖塗黑</span> | Batch Shading Cascade | 連續波前推進，當某一決策確立後，周圍所有衍生約束格瞬間自動收斂。 ↑ 回到矩陣 |
| <span id="glossary-self-avoiding-loop">#自避迴路</span> | Self-Avoiding Hamiltonian Loop | 平面網格上不自交且僅訪問特定點集的單一閉合迴路。 ↑ 回到矩陣 |
| <span id="glossary-pearl-heuristics">#折角定式</span> | Masyu Pearl Heuristics | 珍珠迴路世界競賽標準手筋：黑珍珠必須轉折且兩臂延伸、白珍珠直行且相鄰轉折。 ↑ 回到矩陣 |
| <span id="glossary-cp-solver">#CP-Solver</span> | Constraint Programming Solver | 專為圖論連通性與區域劃分定製的純傳播求解器，優先利用圖論拓撲特性而非盲目窮舉。 ↑ 回到矩陣 |
| <span id="glossary-poisson-tension">#泊松張力</span> | Poisson Disk Tension | 網格節點空間分佈均勻度度量，確保星際數橋題盤無孤島聚集或過度稀疏。 ↑ 回到矩陣 |
| <span id="glossary-capacity-closure">#容量閉包</span> | Capacity Closure | 節點剩餘度數與周圍可用出邊容量上限的閉包比較，容量相等時強制滿載連線。 ↑ 回到矩陣 |
| <span id="glossary-fractal-grid">#碎形網格</span> | Fractal Grid Decomposition | 利用分形遞歸細分生成的迷宮拓撲，天然具備自相似性與長死胡同特徵。 ↑ 回到矩陣 |
| <span id="glossary-reverse-overlap">#反向重疊率</span> | Reverse Overlap Rate | 生成迷宮時逆向驗證有效路徑與非解分支的空間交織度，杜絕一眼望穿的直線通道。 ↑ 回到矩陣 |
| <span id="glossary-topological-deadlock">#拓撲死鎖</span> | Topological Deadlock | 判定迴路或尋路是否落入無法逃脫的局部閉合死胡同。 ↑ 回到矩陣 |
| <span id="glossary-reductio-probe">#歸謬探針</span> | Reductio Ad Absurdum Probe | 有限步深度的前向試探：假設某格成立後若快速推導出度數或配額崩潰，則該格反命題必然成立。 ↑ 回到矩陣 |
| <span id="glossary-causal-tensor">#因果張量場</span> | Causal Tensor Field | 衡量各矩形預覽框對周圍剩餘未決數字在幾何生長空間上的引力與拘束密度。 ↑ 回到矩陣 |
| <span id="glossary-annealing">#向心退火</span> | Double-Tap Annealing | 介面交互防護機制：連續雙擊時以向心幾何縮小動畫平滑取消選擇，防止指尖誤觸。 ↑ 回到矩陣 |
| <span id="glossary-ray-blocker">#射線阻斷傳播</span> | Active Ray Blocker | 黑白分明核心：若一行/列跨越房間的視線長度超標，強制在沿途最優候選位置注入黑格阻斷。 ↑ 回到矩陣 |
| <span id="glossary-bifurcation-entropy">#分歧熵</span> | Bifurcation Entropy | 評估在分支點處兩個可能走向對後續題盤產生的資訊擾動深度差，避免無效分支。 ↑ 回到矩陣 |
| <span id="glossary-alternating-loops">#奇偶交錯環</span> | Alternating Parity Loops | 二分圖上未決邊形成的交錯鏈，用於在無猜測條件下直接推導帳篷與空地的必然歸屬。 ↑ 回到矩陣 |
| <span id="glossary-bipartite-matching">#二分匹配</span> | Hopcroft-Karp Bipartite Matching | 將骨牌拓撲轉化為棋盤黑白格之間的二分圖最大匹配問題，用於瞬態判定覆蓋可行性。 ↑ 回到矩陣 |
| <span id="glossary-residual-capacity">#殘餘容量</span> | Residual Capacity Check | 檢查局部子網格內可用骨牌總數與剩餘格子數量的奇偶匹配度，及早發現無法覆蓋的死局。 ↑ 回到矩陣 |
| <span id="glossary-avalanche">#咽喉雪崩</span> | Avalanche Crux Cascade | 數織與數獨中關鍵瓶頸被攻破後，全盤候選數連鎖自動收斂的骨牌效應。 ↑ 回到矩陣 |
🤝 參與貢獻 (Contributing)
我們熱烈歡迎各界邏輯愛好者、世界競賽國手與演算法工程師共同維護本專案！
 * 報告錯誤 (Bug Report)：若在遊玩中發現「疑似多解」或「推導鏈斷裂（卡在無邏輯盲猜）」的題目，請務必複製該題結算或控制列的 Seed 碼 與遊戲代號，提交至 Issues。
 * 新增遊戲或變體 (New Game / Variant)：
   * 演算法模組請置於 web-frontend/src/engines/，必須保證 100% 純邏輯演繹閉環（禁止暴力回溯偽裝解法）。
   * 介面組件請遵循主鍵位盲打（Vim/Home-row）與零眼動脫鉤手感原則。
   * 請在 web-frontend/src/engines/__tests__/ 編寫嚴格的解空間唯一性與不可約極小化單元測試。
 * 代碼風格與 PR 規範：
   * 提交 PR 前請在本機執行 npm run build 與 npm run test，確保 TypeScript 編譯零錯誤且全套測試通過。
   * 遵循專案已有的不可變狀態架構（Immutable State Transitions）。
隱私與家長承諾 / Privacy Commitment
 * 極致本地化 (Local-First & Offline Resilience)：所有個人最佳紀錄（PB）、作答軌跡與心智雷達圖完全儲存於本機 IndexedDB / LocalStorage，絕不上傳個人隱私資料至雲端。
 * 兒童隱私最高標準 (Zero Tracking)：全站絕無第三方分析腳本（No Google Analytics / No Meta Pixel）、無追蹤 Cookie，符合 COPPA 與歐盟 GDPR-K 規範。
 * 客觀透明認證 (Zero-Trust Receipt)：競賽通關憑證由瀏覽器原生 Web Crypto API 生成 SHA-256 不可篡改數位簽章，完全交由選手自主保管。
📄 授權條款 (License)
本專案採用 MIT License 開源授權，歡迎社群交流與非商業教育推廣使用。

