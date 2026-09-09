# Lawgic 羅輯 (邏輯遊戲 Logic Games)

---

## 📖 關於本專案 / About This Project

> **這是一個為了給兒子伴隨成長而親手打造的遊戲專案。**  
> 誠邀所有同好一同體驗、參與與交流，願我們都能重拾思維頓悟的純粹樂趣！  
> *A personal project handcrafted to accompany my son as he grows up.*  
> *Warmly inviting all puzzle enthusiasts to play, explore, and share the pure joy of logical insight!*

---

## 👨‍👦 伴讀心智圖譜與成長階梯 / Father-Son Pedagogical Roadmap

本專案不僅是純粹的競賽平台，更是依據皮亞傑認知發展階段論（Piaget's Theory）與 CHC 智力理論體系，為孩子長期思維躍遷量身打造的成長陪伴工具：

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

繁體中文介紹
平台簡介
Lawgic 羅輯 是一款依據世界謎題聯合會（WPF）、世界數獨錦標賽（WSC）與國際智力運動規章打造的現代化純邏輯競賽平台。平台徹底摒棄偽難度猜題與盲目窮舉，將 高效能 Rust/WebAssembly 零拷貝核心、離線 SMT/SAT 生成守護進程（Generator Daemon）、前 0.1% 錦標賽級確定性生成引擎（Deterministic Procedural Engines）、離散圖論約束求解唯一解驗證、CHC 心理測量學模型 與純粹無干擾的賽場級快捷操作融合，提供具備可驗證因果鏈條的職業級大腦心流競技環境。
伴讀與階梯式思維成長 (Pedagogical Philosophy)
 * 直覺引導而非死記硬背：全平台題型均配置嚴密平滑的階梯式難度（Kids ➔ Intermediate ➔ Expert ➔ Master ➔ Legendary ➔ Ultimate）。低階題目專注於啟發兒童對空間對稱、連通閉合、奇偶校驗與因果鏈條的純粹直覺；高階題庫無縫對軌世界解謎錦標賽（WPC）決賽圈水準。
 * 零視覺干擾與沉浸心流：為守護最純淨的思維專注力，全站嚴格剔除商業廣告、抽卡獎勵、代幣商城與暗黑引導機制，回歸黑體與幾何秩序本身的純粹之美。
架構特色
 * WASM 零拷貝記憶體與查表常數加速：核心數獨與密集型運算模組全面以 Rust 編寫並編譯為 WebAssembly，具備編譯期預算靜態鄰居查表（LUT）與共享記憶體視圖（Zero-Copy Memory View），實現超低功耗與次毫秒級狀態收斂。
 * 數學級唯一解證書（Exact Cover Uniqueness Engine）：拒絕「算力不夠即判定唯一」的偽科學。全面實裝 AC-3 弧相容傳播、在軌動態 MRV 啟發式剪枝、12000 節點回溯防護與二分匹配，數學證明解空間基數精確為 1，杜絕多解殘局與超時作弊。
 * 純邏輯閉環與因果推導率（100% Pure Deduction Rate & Breakpoint Ratio）：高難度題目（Master / Legendary / Ultimate）嚴格執行人類邏輯求解鏈模擬，實裝真實邏輯斷點深度比（Breakpoint Ratio \ge 80\%），消滅早盤盲猜分支，確保試誤僅沈澱於尾盤收割。
 * 真實認知轉折點（\Delta\text{Domain} Entropy Crux & Eureka Moments）：告別機械式技巧標籤。以每一步手筋造成的「加權候選域熵減量（\Delta\text{Domain}）」與「DAG 拓撲影響半徑」精確錨定破局天王山（Crux），動態捕捉交響樂般的頓悟波峰（Eureka Peaks）。
 * WPC / WSC 賽場級鍵位與心流防護（Speed-Solving Ergonomics）：
   * 數獨魔陣 (sudoku)：
     * 雙向認知共振架構 (Bi-Directional Cognitive Engine, BDCE-v9.1)：並聯「正向拓撲爆破」與「反向死局預判」。在進入深層搜尋前，主動掃描致命模式（Deadly Patterns），實裝 唯一矩形 (Unique Rectangle Type 1~4) 與 全雙值致命墓地 (BUG+1) 悖論排除，以元認知（Meta-Cognition）打破窮舉。
     * 超維魚族與 Junior Exocet 嚴格約束：超越傳統 X-Wing，原生支援 Swordfish (3x3 空間投影)、XY-Wing 雙值樞紐 與頂級決賽圈專屬的 Junior Exocet (JE) 遠程同位素映射，並實裝嚴格 S-Row / S-Col 閉包驗證，杜絕幾何偽陽性。
     * 集合覆蓋 A* 與連續環雪崩 (A* AIC & Continuous Nice Loops)：以集合覆蓋維度收斂（Set-Cover Distance）作為啟發函數 h(n)，突破傳統 BFS 的 Depth-8 指數爆炸；支援動態信賴深度（Dynamic Trust Depth，最高穿透至 22 步）與連續環（Nice Loop）閉合，實現弱連結全面晉升後的單步多點候選數雪崩。
     * Miller 7±2 認知波束與工作記憶衰減剪枝：將 A* 優先佇列限縮為嚴格 7 寬度波束（Beam-7），配合早期閉合引力場（Early Closure Gravity）剪除發散盲枝；尾盤剩餘 <15 格時動態收縮為 4±1 波束，完美擬合人類極限狀態下的注意力流向。
     * 因果必要性審計 (Causal Necessity Test)：淘汰單純同行同列覆蓋的偽標記，以反事實介入驗證（Counterfactual Intervention）確保留存的每個提示格皆實質參與求解路徑，100% 剷除「邏輯孤兒（Dangling Clues）」。
     * DLX 精確覆蓋骨架植入 (Skeleton-Driven Implantation)：高階題型摒棄隨機 Monte Carlo 碰撞，採用 Dancing Links (DLX) 將頂級定式骨架種子毫秒級精確覆蓋回填，實現 50ms 級確定性落地，並施加同構置換模糊化以抹除「人工刻意指紋」。
     * 微秒級事件循環脫鉤 (<5ms Input Latency)：鍵盤落子響應與 checkVictory / 密碼學雜湊計算以 queueMicrotask 完全脫鉤，杜絕重度演算法阻塞按鍵渲染循環。
     * 次視覺化合法候選底紋 (Sub-visual Auto-Candidates)：選中空格即時以 text-slate-600/40 極低對比度灰階浮現合法數字，僅在注視時提供潛意識驗證，杜絕高亮藍光引發的無意識注意力捕捉。
     * 雙軌 800ms 防誤觸投降機制 (Hold-to-Resign)：滑鼠長按與鍵盤長按 [R] 鍵共享 800ms 時間閥與 requestAnimationFrame 進度填充，徹底消除終局緊張時誤觸「🕊️」導致的心流崩潰。
     * 零延遲 Web Audio 聲學回饋：內建原生 AudioContext 合成振盪器，以 20ms 1200Hz 正弦波提示落子成功、260Hz 鋸齒波執行評測硬阻斷警告，提供競技級實體打擊感。
     * 外圈 A-I / 1-9 坐標錨點與向量 SVG 拓撲導引：外圍標註標準國際棋規坐標；推導步驟支援編譯為紅強藍弱的向量線段數據，實現賽後復盤的拓撲光影直接投影。
   * 帳篷扎營 (tents)：
     * v3.0 零猜測純傳播與圖論同調 (Zero-Assumption & Parity Homology)：摒棄截斷步數回溯（stepBudget）之偽唯一解漏洞，採用純粹約束傳播與二分圖交錯路徑奇偶性（Alternating Parity Loops）。題目 100% 具備人類嚴密演繹閉環，嚴格實裝極小化檢定（Critically Minimal），移除任意樹木或行列線索即崩塌為多解。
     * 雙向因果前瞻向量漣漪 (Forward Vector Ripples)：淘汰粗暴的「點擊防呆彈窗攔截」。游標懸停未決格即啟動微秒級 2-SAT 前瞻探針，以半透明暗紅向量光線預先繪製「跨維度因果衝突鏈（8向碰撞、配額溢出、遠端樹木窒息）」，容許選手在知曉後果下悲壯落子。
     * 前注意瞬態對比拉伸 (Preattentive Contrast Stretch)：長按 [Ctrl] 啟動全局資訊熵減光場（Entropy Gain Map）。抑制低增益噪聲，當且僅當存在引爆多米諾骨牌連鎖之關鍵突破格（\Delta H \ge 2.5\text{ bits}）時，背景自動壓暗至 35%，目標格爆發熾白孤立脈衝，實現前注意加工毫秒級定位。
     * 無感手勢自由墨跡 (Canvas Ink Scratchpad)：長按 [Alt] + 拖曳滑鼠 直接在棋盤幾何層上隨手圈畫懷疑區域或指向箭頭，向量墨跡零延遲渲染且不污染標準題解，徹底消除「打字記錄破壞大腦工作記憶」的認知氧化層。
     * 四維平行宇宙殘影差分 (Ghost Branch Superposition)：落子自動存入因果快照歷史，按住 [Shift] + 滾輪 即可將過去決策以 30% 半透明「幽靈殘影」原地疊加於當前棋盤，零延遲即時目視對比兩大平行分支的拓撲勢能差。
     * 思維心搏動態共振 (Mind Pulse Halo Resonance)：底層演算法即時積分墨跡軌跡之環繞度（Winding Angle \ge 4.8\pi）。當偵測到選手在特定關鍵格反覆畫圈徘徊、陷入認知猶豫臨界態時，系統不彈窗、不打擾，僅在目標格邊緣靜默泛起微弱的同頻呼吸光暈，實現人機認知共生。
     * 阻尼相位鎖儀表 (Damped Parity Phase Lock)：將全域行列奇偶差值（\Delta\Phi = \sum\text{RowDeficit} - \sum\text{ColDeficit}）抽象為帶有物理阻尼感的動態指針，實時反饋全域閉鎖狀態（LOCKED vs DRIFT），提供宏觀勢能直覺。
     * 微縮拓撲雷達像元 (Miniature Topology Radar)：以 1:1 等比發光像元替代傳統文字座標跳轉，將全盤狀態直接映射為視覺梭狀回可並行識別的幾何模式。
     * 標準 WPF 複合連號題解格式：嚴格依據世界謎題錦標賽規範輸出 Answer Key，每行由小至大遞增拼接帳篷所在欄位編號（無帳篷標 0），支援常數時間密碼學對撞驗證。
   * 摩天透視 (skyscraper)：
     * 無模態時間動態輸入 (Modeless Temporal Keypress)：敲擊（<200ms）確信落子、長按（≥200ms）自然切換草稿候選數（Pencil Marks），徹底終結傳統數獨/天際線工具中「頻繁切換鉛筆開關」的工作記憶磨損。
     * Vim 級全主鍵位盲打 (Home-Row Ergonomics)：全面支援 H/J/K/L 與 W/A/S/D 游標磁吸平移，搭配 QWERTY 鍵位直映數字（Q~O / A~L），實現雙手完全不離主鍵區的競速操控。
     * 預測性虛擬沙盤 (Pre-flight Ray Sandbox)：按鍵落子前微秒級射線投射，即時計算該高度對四向視線的幾何影響；若將觸發不可逆違規，外圍線索即時觸發柔和預警，提供前瞻性心智沙盤。
     * 漸進揭露式元認知階梯 (Metacognitive Ladder)：三級引導體系（Level 1 宏觀戰略聚焦 ➔ Level 2 戰術原理解析 ➔ Level 3 微觀落子執行），拒絕機械式劇透，引導選手自主頓悟。
     * 可解釋性幾何衝突診斷 (Occlusion Diagnostic)：即時捕捉前綴超標與容量擠壓失效，點擊紅化線索即刻彈出數學級診斷說明（如「未填滿前可見樓層已超標」）。
     * 三幕式實時節奏標尺 (Pacing Metronome)：依據難度 Logit 動態切分開局（20%）、中局轉折（55%）與終局連鎖（25%）時間槽，實時顯示領先/滯後秒數（Delta Bar），精確調控解題節奏。
   * 四角分割 (shikaku)：
     * 八分節段頂點奇偶光流 (Octant Segmented Vertex Parity)：邊界光流嚴格以矩形 4 個幾何角點（Vertices）落在邊界節段上的接觸次數為基準，消除覆蓋長度造成的拓撲相位差，餘光瞬態定位缺陷象限。
     * 四維因果張量質量場 (Causal Tensor Field)：預覽框輝度直接反映其對未解質數與邊界線索走向的空間拘束密度，徹底擺脫單純貼邊長度的平面誤導。
     * 雙擊退火蒸發 (Double-Tap Annealing)：單擊戰術冷審視高亮、280ms 雙擊觸發 150ms 幾何向心退火縮小消失並伴隨 45ms 頓挫震動，徹底杜絕指尖靜電誤觸導致的心流崩塌。
     * 奇異點引力坍縮與無字觸覺遙測 (Singularity Collapse & Haptic Wave)：結算瞬間矩形向最後落子質心向心爆炸塌陷為點；全盤徹底無字化，賽後秒數與步數透過 Web Vibration API 原生編碼為長短脈衝引力波（長震為十位、短震為個位），觸碰事件視界即可隨時觸覺重讀。
   * 迴路封閉 (slitherlink)：
     * 7 步認知極限波束反證 (Human-Bounded Beam-3 BFS)：拋棄電腦無上限暴力窮舉，將前向試錯深度嚴格錨定在人類短期工作記憶極限（\le 7 步），配合寬度為 3 的波束搜尋（Beam-3 BFS）同時驗證度數溢出、線索餓死與 DSU 拓撲死環，杜絕非人道計算題。
     * 四維認知範疇與破局轉折點 (Cognitive Inflection Tracking)：演繹步進全面語意範疇化（候選域收斂 ➔ 幾何定式 ➔ 拓撲死環防禦 ➔ 反證假說），精確標記思維維度躍遷的「邏輯高潮點」，配合四象限空間 Shannon 熵（\ge 0.85）確保題目兼具時間韻律與空間呼吸感。
     * 雙態幾何衝突透視 (Overflow vs. Starvation Radar)：超越傳統單一線條超標報警，即時運算「邊界殘餘容量閉包（4 - \text{Crosses} < \text{Clue}）」，以琥珀色高亮提前警示「局部線索餓死死鎖」，將無效推理扼殺於萌芽。
     * Zen 專注心流與寧靜閉合 (Zen Mode & Pure Finish)：支援全主鍵盲打操控（[F] 專注模式、[H] 定式因果、[N] 無猜測開關、[Ctrl+Z/Y] 撤銷重做），通關瞬間以非侵入式微型光環橫幅取代喧鬧彈窗；支援 Shift + 點擊 戰術強制覆寫與 🧪 [Trial] 試錯純度獨立標記，兼顧新手護欄與大師實驗自由。
     * 多語言定式因果字典 (Multilingual Technique Registry)：徹底廢棄機械代碼，即時以母語（中/英/日/德）展示「對角雙 2 排斥」、「1-3 相鄰互斥」、「斜對角 3-0 鎖定」等世界錦標賽定式名稱與因果解析鏈。
     * 跨分頁無感秒級恢復 (Session Resilience)：底層綁定 sessionStorage 狀態快照，長達數十分鐘的 Ultimate 終極棋譜即時自動固化，誤觸重整無縫續盤。
   * 矢印連線 (yajilin)：
     * WPC 官方級三層認知演繹 (L1/L2/L3 Cognitive Solver)：徹底告別單純黑格枚舉與局部 2x2 拼湊，分層實裝「L1 基礎數值定式（0 箭頭/配額吞噬）」、「L2 拓撲度數守恆（端點追蹤/口袋奇偶割）」與「雙向 L3 假設性矛盾排除（Bidirectional Lookahead）」，確保 100% 邏輯可解。
     * 深度分佈推土機距離校準 (EMD Cognitive Calibration)：廢除機械式時序鎖定，導入一維 Earth Mover's Distance (EMD) 擬合世界謎題錦標賽官方決賽題之難度直方圖，並依分級動態調整容差（Kids 0.18 ~ Ultimate 0.07），嚴格塑造「階梯爬升、終局爆破」的黃金解題韻律。
     * 自適應印刷物理與光學防擁擠 (Scale-Invariant Typography)：根據盤面維度動態縮放光學安全間距（dynamicThreshold），主動偵測平行射線干擾與「十字垂直對穿（Crosshair Overlap）」，根除實體紙筆印刷與高速掃視下的空間視錯覺。
     * 雙軌必要性與大師心錨保留 (Psychological Priming Anchors)：在保證「全盤題目不可約簡」的前提下，允許保留至多 2 個高價值「中心低數值心理錨點（Psychological Anchors）」，輔助選手迅速建立開局視覺注意力焦點。
     * 指尖神經反應拖曳狀態機 (Zero-Saccade Drag-to-Draw)：
       * 非正交瞬態熔斷重錨：拖曳連線遇對角偏移瞬間激發 10ms 微震顫並原位重設起點，杜絕高速滑行下的「跨空格幽靈線」。
       * 剛性無猜測度數白名單：開啟 No-Guess 模式時，強制鎖死所有非定式允許邊界，非法修改即刻觸發原位 2.5px 震盪與紅框泛紅，徹底摒棄彈窗文字，實現眼動零脫鉤（Zero Saccade Interruption）。
       * 局部 3×3 衝突過濾：游離端點脈衝（Degree=1 Pulse）僅受局部 3×3 曼哈頓半徑約束，遠端錯誤不誤殺當前通路導航。
       * 跨平台自適應勝利感官：觸控端釋放漸強防滑脫脈衝序列（[30, 40, 40, 40, 80]）；桌面端無縫切換為視網膜微白閃爍與 587.33Hz (D5) 瞬態結晶正弦音。
   * 暗夜數牆 (nurikabe)：左鍵黑海 / 右鍵白點 / Shift 鍵直達三態分治、零顏色語義干擾之純邊框警告 HUD、全域必然性白名單校驗與雙割點假設態自動切換、無級歷史時間軸滑塊（Timeline Scrubber）與歷史違規幀快速跳轉、AI 覆盤殘局斷點無縫接管（Take Over）、雙軌時鐘（物理掛鐘 vs. 純粹運算時間）輸出客觀思考密度（Density of Thought）。
   * 黑白雙星 (kropki)：正統數獨宮格拓撲、貫穿式負約束微結構細虛線（No-Dot Barrier）、同數戰場十字光環高亮、8ms 觸覺行程微震動反饋、可逆 Auto-Notes 快照避險、20% 分段配速條（Splits Telemetry）。
   * 數和密碼 (kakuro)：跑道局部性解空間、180° 對稱區塊侵蝕黑牆、所見即所填候選條、極限和差集合閉包、真·正交容量閉區間擠壓（Capacity Squeeze）、中盤模 9 數字根同餘剪枝。
   * 黑白分明 (heyawake)：BSP 互鎖咬合 L-Room 齒輪切割、主動射線閉包傳播（Active Ray Blocker）、連續黑格跨界禁止、真雙分支分歧熵評估、二態極速切換、靜默咽喉割點雷達、WASD/方向鍵磁吸鎖定。
   * 天平不等 (futoshiki)：Knuth 無偏真隨機拉丁方、全量 Naked/Hidden Pair 雙格數對引擎、Floyd-Warshall 矩陣全域複用、中局平行分支度（\ge 2.4）、雙擊鎖定注入模式 (Injection Mode)、殘局拓撲排序調度加速。
   * 隻眼獨尊 (hitori)：視覺優先手筋層（三連全推導/夾心三明治）、計數白黑雙向閉環、防連環碰撞批量塗黑、\Delta\text{Domain} 加權熵減 Crux、紙本鉛筆草稿三態標記（Pencil Marks）、50ms 極速無解熔斷。
   * 燈泡照明 (lightup)：偽布林（PB）基數不等式邊界收緊、全域 2-SAT Kosaraju SCC 蘊含圖傳播、雙向對稱歸謬探針（±Reductio）、動態美學拓撲（低階連通長城 / 高階孤島光阱）、頓悟峰值心流計量、左右鍵瞬發雙模落子、行動端 Mode Stick。
   * 珍珠迴路 (masyu)：隨機自避蜿蜒迴路變形、黑珍珠雙向伸展與白珍珠直行折角定式、相鄰黑珍珠排斥死鎖剪枝、邊界切向防自交閉合、CSP 唯一性精確覆蓋驗證。
 * 臨床級反作弊監控與專業監考（Proctoring & Anti-Cheat）：整合 useAntiCheatMonitor、clinicalProctoring 與硬體級輸入防漂移偵測，確保錦標賽競技數據的客觀嚴密。
 * 嚴格賽事裸裝模式（Strict Tournament Mode）：開啟賽事模式即強制隱蔽所有即時衝突紅框、波浪輔助線與虛假標稱配額，鎖定盤面禁止提示，還原國際大賽現場的「無輔助裸裝對決」。
 * 零信任防偽存證簽章（Zero-Trust Receipt）：通關後透過 Web Crypto API 原生硬體加速生成 SHA-256 數位簽章與常數時間核驗，確保各項賽事通關憑證與個人最佳紀錄（PB）無法篡改。
 * 全封閉離線 PWA 體驗：整合具備 1.8 秒超時熔斷保護與 WebAssembly 二進制快取特化之 Service Worker，配合 iOS 動態島與底部 Safe Area 邊界適配，支援手機、平板與桌面端全螢幕離線流暢遊玩。
核心遊戲矩陣 (Core Game Matrix - 18 款正式遊戲)
| 代號 | 遊戲名稱 | 核心能力維度 (CHC) | 演算法與賽事級特點 |
|---|---|---|---|
| skyscraper | 摩天透視 | 3D 心理旋轉 (Gv)、圖論約束傳播 (Gf)、工作記憶 (Gwm) | 雙向視線帶剪枝 Line-CSP 排列求解器、推導依賴有向無環圖 (Derivation DAG)、破局天王山張力評估 (The Crux Metric)、Cowan 4-Chunk 記憶極限校準懲罰、格式塔模塊壓縮率 (0.35~0.45)、終局反機械化審美濾鏡、四邊線索視覺熵和諧度檢驗、無模態長按草稿標記、Vim 盲打、預測性沙盤微光、賽後破局點劇本覆盤 |
| shikaku | 四角分割 | 幾何整除、空間張量、頂點奇偶 | 互鎖咬合波前生長（Interlocking Growth）、破缺對稱（90/10 誘敵背刺）、邊界頂點奇偶閉合鎖定（Boundary Vertex Parity Lock）、因果張量質量場預覽、雙擊退火蒸發、奇異點向心引力坍縮、純觸覺震動脈衝電碼遙測（Zero-Text Haptic Telemetry） |
| slitherlink | 迴路封閉 | 拓撲閉環、空間幾何定式 (Gv)、歸謬推理 (Gf) | 螺旋漢密爾頓擾動自然環路、雙向對角雙 2 / 1-3 相鄰互斥定式、7 步認知極限 Beam-3 BFS 反證探針、四象限空間 Shannon 熵平衡、語意範疇轉折點、Zen 專注模式、超標/飢餓雙態衝突雷達、Shift 戰術試錯覆寫標記、WPC 冠軍思路模板生成 |
| yajilin | 矢印連線 | 拓撲迴路 (Gv)、歸謬推導 (Gf)、動態視覺搜尋 | WPC 官方推薦級認知架構、三層認知演繹 (L1/L2/L3)、雙向反證排他剪枝、深度分佈 EMD 擬合、動態印刷光學互斥（防十字對穿）、大師心理錨點保留、指尖拖曳狀態機、原位震盪防眼動脫鉤、3×3 局部衝突過濾、雙軌時間戳 Merkle 密碼學存證 |
| nurikabe | 暗夜數牆 | 平面連通、圖論割點、拓撲張力 | 多源形態發生競賽生長（Morphogenesis）、動量轉向纏繞度調控、雙割點拓撲奇點過濾（Dual-Cut Singularity）、傳播優先回溯（CP-Solver）唯一解驗證、純邊框 HUD 透視、時間軸違規熱點書籤、思考密度（Density of Thought）計量 |
| kropki | 黑白雙星 | 數理偏序、宮格空間排他 | 正統數獨宮格拓撲（2x2/2x3/3x3）、全相鄰無點負約束（Full Kropki）、雙向 X-Wing 魚形排除、4x 超加權樞紐錨定、真實斷點深度比（\ge 80\%）、貫穿虛線屏障、8ms 觸覺行程鍵盤 |
| kakuro | 數和密碼 | 整數分割、數論同餘閉包 | 跑道局部性獨立去重、180° 對稱區塊侵蝕黑牆、雙向極限和差集合閉包、真·正交容量閉區間擠壓（Capacity Squeeze）、中盤模 9 數字根同餘剪枝、封閉疊代局部傳播、所見即所填候選條 |
| maze | 空間迷宮 | 空間導航、心智心圖 | 質數動態網格碎形、雙入口時間黑洞、視覺直線性後悔值、雙胞胎地標悖論、重疊率 <40\% 逆向驗證、Boss 二階段精神污染 |
| sudoku | 數獨魔陣 | 約束傳播 (Gf)、工作記憶 (Gwm)、反向悖論驗證 | 雙向認知共振引擎 (BDCE-v9.1)、DLX 骨架植入、集合覆蓋 A* AIC (動態深度 22 步)、連續環閉合雪崩、Junior Exocet (S-Row 嚴格驗證)、Unique Rectangle (Type 1~4) / BUG+1 悖論破局、因果必要性無孤兒審計、Miller 7±2 動態認知波束、尤里卡突刺 (Eureka Prominence \ge 6) 與後置雪崩率檢驗、微秒級 microtask 脫鉤、次視覺化底紋、雙軌 800ms 投降保護、A-I 坐標系、Web Audio 實體反饋 |
| nonogram | 像素數織 | 離散斷面掃描、衝動抑制 | 全向量化 Bitmask DP 單行交集、二維全域泛洪反證、DAG 依賴樹、Master Key 咽喉雪崩、400px 逐行光波斜向綻放、50 步 Undo 堆疊 |
| dominoes | 骨牌矩陣 | 二維鋪砌、全域配對覆蓋 | 數值感知二分匹配瓶頸割裂、MRV 前置剪枝無預算作弊、結構化棋譜反證鏈、行列雙重殘餘容量檢驗、邊角優先釘定與 32px 擴展抗干擾熱區 |
| hashi | 星際數橋 | 拓撲連通、生成樹度數 | 泊松圓盤四向張力均勻度、真 Tarjan 割邊雙橋暴力美學、前向最大容量擠壓（Max Capacity Fail）吃滿深度反證探針、連續純度光譜、42px 防漂移觸控外圈 |
| heyawake | 黑白分明 | 拓撲割點、視線阻斷 (Gv)、圖論著色 | BSP 互鎖咬合 L-Room 齒輪切割、主動射線閉包傳播（Active Ray Blocker）、連續黑格跨界禁止、真雙分支分歧熵評估、二態極速切換、靜默咽喉割點雷達、WASD/方向鍵磁吸鎖定 |
| futoshiki | 天平不等 | 有向無環圖 (DAG)、偏序傳遞閉包 | Knuth 無偏真隨機拉丁方、全量 Naked/Hidden Pair 雙格數對引擎、Floyd-Warshall 矩陣全域複用、中局平行分支度（\ge 2.4）、雙擊鎖定注入模式 (Injection Mode)、殘局拓撲排序調度加速 |
| hitori | 隻眼獨尊 | 負向排除、候選域熵減 (Gf) | 視覺優先手筋層（三連全推導/夾心三明治）、計數白黑雙向閉環、防連環碰撞批量塗黑、\Delta\text{Domain} 加權熵減 Crux、紙本鉛筆草稿三態標記（Pencil Marks）、50ms 極速無解熔斷 |
| tents | 帳篷扎營 | 二分圖同調、空間排他 (Gv)、歸謬因果 (Gf) | v3.0 靜默自指純傳播核心 (Zero-Assumption)、二分圖交錯路徑奇偶覆蓋、不可約極小化審定 (Critically Minimal)、動態前瞻因果向量漣漪、前注意瞬態對比拉伸（\Delta H \ge 2.5\text{ bits} 脈衝）、Alt 自由墨跡畫布、Shift 滾輪平行宇宙殘影差分、思維心搏環繞檢測呼吸光暈、阻尼相位鎖儀表盤、微縮拓撲雷達、標準 WPF 官方多行複合連號 Answer Key |
| lightup | 燈泡照明 | 視線投射、全域命題邏輯 (Gf) | 偽布林（PB）基數不等式邊界收緊、全域 2-SAT Kosaraju SCC 蘊含圖傳播、雙向對稱歸謬探針（±Reductio）、動態美學拓撲（低階連通長城 / 高階孤島光阱）、頓悟峰值心流計量、左右鍵瞬發雙模落子、行動端 Mode Stick |
| masyu | 珍珠迴路 | 空間拓撲、正交折角約束 (Gv) | 隨機自避蜿蜒迴路變形、黑珍珠雙向伸展與白珍珠直行折角定式、相鄰黑珍珠排斥死鎖剪枝、邊界切向防自交閉合、CSP 唯一性精確覆蓋驗證 |
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

技術架構與極限優化 / Technical Architecture
┌─────────────────────────────────────────────────────────────┐
│                         Lawgic Presentation Layer           │
│    (React 18 + TailwindCSS + iOS Safe Area + PWA Hardened SW)│
└──────────────┬───────────────────────────────┬──────────────┘
               │                               │
               ▼ (Zero-Copy Pointer)           ▼ (Causal Step Stream)
┌──────────────────────────────┐ ┌────────────────────────────┐
│      WASM Core (Rust)        │ │  Procedural TS Engines     │
│  • Compile-time PEERS LUT    │ │ • Full Kropki Box Topology │
│  • Bitmask MRV Propagation   │ │ • Run-Local Modulo-9 Sieve │
│  • O(1) Backtrack Snapshot   │ │ • Dual-Cut Singularity Nur │
│                              │ │ • Vertex Parity Shikaku    │
│                              │ │ • Fast Line-CSP Skyscraper │
│                              │ │ • 2-SAT Kosaraju SCC Blk   │
│                              │ │ • Beam-3 BFS Slitherlink   │
│                              │ │ • Bi-Directional BDCE-v9.1 │
│                              │ │ • Zero-Assumption Tents v3 │
│                              │ │ • 3-Layer Cognitive Yajilin│
└──────────────┬───────────────┘ └─────────────┬──────────────┘
               │                               │
               └───────────────┬───────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                     Clinical Integrity Layer                │
│  Anti-Cheat Monitor + SMT Welder + Web Crypto SHA-256 Auth  │
└─────────────────────────────────────────────────────────────┘

English Introduction
Overview
Lawgic is a professional-grade competitive logic puzzle platform engineered to the standards of the World Puzzle Federation (WPF), World Sudoku Championship (WSC), and international mental athletics associations. Rejecting brute-force guessing and memory drills, the platform fuses high-performance WebAssembly kernels, deterministic procedural generation, SMT-welded puzzle daemons, CSP uniqueness validation, CHC cognitive models, and precision interaction for an ad-free, pure intellectual experience.
Architecture Highlights
 * Zero-Copy WASM Core: Computationally intensive solvers are written in Rust and compiled to WebAssembly, featuring compile-time static lookup tables (PEERS_TABLE) and zero-copy shared array memory mapping.
 * Exact Cover Uniqueness Engine: Mathematical certainty replacing heuristic timeouts. Across Sudoku, Nonogram, Dominoes, Hashi, Heyawake, Futoshiki, Hitori, Kakuro, Kropki, Light Up, Nurikabe, Yajilin, Shikaku, Slitherlink, Skyscraper, and Tents, exact MRV backtracking solvers, Line-CSP engines, and value-constrained bipartite matching proofs guarantee puzzle solution cardinality equals exactly 1.
 * 100% Pure Deduction Rate & Breakpoint Ratio: Master, Legendary, and Ultimate tiers strictly enforce complete human deductive chain simulations with Breakpoint Depth Ratio \ge 80\%, discarding puzzles requiring trial-and-error branching during early and mid games.
 * True Cognitive Crux via \Delta\text{Domain} Reduction: Crux points are quantified using weighted candidate domain entropy reductions and DAG topological radii rather than arbitrary heuristic weights.
 * Speed-Solving Ergonomics:
   * Sudoku:
     * Bi-Directional Cognitive Engine (BDCE-v9.1): Synthesizes forward topological propagation with reverse paradox verification. Scans Deadly Patterns before deep exploration, executing Unique Rectangle (Type 1~4) and BUG+1 meta-cognitive eliminations.
     * Hyper-Dimensional Fish & Junior Exocet: Native support for Swordfish (3x3 spatial projection), XY-Wing, and championship-tier Junior Exocet (JE) with strict S-Row/S-Col closure validation.
     * Set-Cover A & Continuous Nice Loops*: Employs Set-Cover Dimensional Convergence as the heuristic function h(n), piercing through the Depth-8 exponential explosion with Dynamic Trust Depth up to 22 steps.
     * Miller 7±2 Beam & Memory Decay Pruning: Restricts the A* priority queue to a strict Beam-7 width with early closure gravity pruning, dynamically contracting to 4±1 beams in the endgame.
     * Causal Necessity Audit: Replaces naive unit-coverage with counterfactual interventions, ensuring every remaining clue directly impacts the deduction sequence.
     * DLX Skeleton-Driven Implantation: Implants seed structures via Dancing Links (DLX) for deterministic sub-50ms synthesis, followed by isomorphic blurring.
     * Microsecond Microtask Decoupling (<5ms): Decouples input state transitions from victory evaluation via queueMicrotask.
     * Sub-visual Auto-Candidates: Passive grayscale candidate matrix (text-slate-600/40) providing subconscious verification without involuntary attentional capture.
     * Dual-Track Hold-to-Resign (800ms): Synchronizes mouse hold and keyboard [R] hold with requestAnimationFrame progress telemetry to prevent accidental resignations.
     * Zero-Latency Web Audio Synthesizer: Native AudioContext synthesized feedback (20ms 1200Hz sine for success, 260Hz sawtooth for assessment rejection).
     * Perimeter A-I / 1-9 Coordinates & Vector SVG Anchors: Full tournament-compliant alphanumeric labeling paired with vector coordinate exports for visual replay.
   * Tents:
     * v3.0 Zero-Assumption & Parity Homology: Eliminates truncated backtracking (stepBudget), utilizing pure constraint propagation and alternating parity loops in bipartite graphs with strictly enforced Critically Minimal proof criteria.
     * Forward Vector Ripples: Pre-flight speculative probe casting translucent red causal vectors upon hover, illustrating multi-step conflicts (asphyxiation, overflow, diagonal touch) without modal interception.
     * Preattentive Contrast Stretch: Holding [Ctrl] suppresses visual noise across low-gain cells and fires an isolated white pulse on cells exhibiting quantum-leap entropy reduction (\Delta H \ge 2.5\text{ bits}).
     * Canvas Ink Scratchpad & Ghost Branch Superposition: Alt + Drag allows natural vector doodling directly over the grid; Shift + Wheel superimposes parallel universe snapshots as a 30% translucent ghost layer for instant topological differential analysis.
     * Mind Pulse Detection & Damped Phase Lock: Continuously integrates stroke winding angles (\ge 4.8\pi) to detect hesitation over crux cells, projecting a subtle breathing halo in silent cognitive resonance. Visualizes global parity deviation (\Delta\Phi) via a physical damped gauge alongside an instant miniature topological radar.
   * Skyscraper:
     * Modeless Temporal Input: Tap (<200ms) for firm placement; hold (≥200ms) for candidate pencil marks, eliminating modal toggling friction.
     * Vim-Style Home-Row Ergonomics: Zero-travel HJKL / WASD cursor navigation paired with direct QWERTY number mapping (Q-O / A-L) for pure touch-typing speed.
     * Pre-flight Ray Projection: Real-time orthogonal sightline simulation predicting feasibility before commitment, casting subtle warning halos on prospective violations.
     * Metacognitive Hint Hierarchy: Progressive 3-tier coaching disclosure (Macro Strategy ➔ Tactical Mechanism ➔ Actionable Placement) preserving organic Eureka discovery.
     * Explainable Occlusion Diagnostics: Real-time detection of prefix saturation and capacity squeeze failures, clicking red clues immediately displays mathematical diagnostics.
     * Real-time Pacing Metronome: Live delta bar benchmarking time against 3-act cognitive allocations (Opening 20%, Midgame Crux 55%, Endgame Cascade 25%).
   * Shikaku:
     * Octant Segmented Vertex Parity: Edge halo strictly tracks corner touches (Vertices) across perimeter segments rather than raw overlap lengths, eradicating phase errors and enabling peripheral defect localization.
     * 4D Causal Tensor Field: Real-time mass luminance projecting constraints onto prime and corner degrees of freedom, discarding superficial edge-length brightness.
     * Double-Tap Annealing: Single-tap cold tactical inspection; 280ms double-tap triggers a 150ms geometric implosion disappearance accompanied by a 45ms tactile notch, preventing misclick-induced cognitive blackout.
     * Singularity Collapse & Haptic Waves: Centroid-directed implosion upon completion; full textless canvas with elapsed time and moves encoded into Web Vibration pulses (long pulse for tens, short for units).
   * Slitherlink:
     * Human-Bounded Beam-3 Lookahead: Strictly caps proof-by-contradiction depth to 7 steps (aligning with human working memory limits) with a Beam-3 BFS engine checking degree overflow, clue starvation, and topological subloops simultaneously.
     * 4-Tier Cognitive Domain & Inflection Point Telemetry: Deductive steps categorized semantically (Candidate ➔ Geometric ➔ Topological ➔ Hypothetical), dynamically identifying Crux phase shifts with 4-quadrant spatial Shannon entropy (\ge 0.85).
     * Dual-State Geometry Conflict Radar: Instantaneously evaluates both line overflow and clue starvation (4 - \text{Crosses} < \text{Clue}), visually warning players of premature edge exhaustion with an amber warning halo.
     * Zen Focus Mode & Quiet Resolution: Full home-row keybindings (F for Zen toggle, H for hint, N for no-guess, Ctrl+Z/Y for undo/redo), replacing celebratory modal popups with an elegant completion banner; supports Shift+Click tactical bypass with explicit [Trial] purity ledger tagging.
     * Multilingual Technique Registry & Session Resilience: Full i18n deduction labels (EN/ZH/JA/DE) replacing raw snake_case keys, backed by seamless sessionStorage crash-proof state restoration.
   * Yajilin:
     * WPC Tournament-Grade 3-Tier Cognitive Architecture: Implements a strict hierarchical solver (L1 Base Heuristics ➔ L2 Degree Conservation ➔ L3 Bidirectional Contradiction) providing mathematically proven human solvability.
     * Earth Mover's Distance (EMD) Difficulty Calibration: Replaces brittle step-timing checks with 1D Wasserstein distance fitting against historical WPC championship profiles, enforcing dynamic EMD thresholds (0.18 to 0.07).
     * Scale-Invariant Optical Repulsion: Dynamically sizes clue clearance buffers, automatically identifying and discarding visual crosshair intersections to eliminate optical crowding on printed diagrams and screens.
     * Psychological Priming Anchors: Selectively preserves up to two central low-count clues as cognitive anchors, accelerating the initial focal entry without violating strict mathematical irreducibility.
     * Zero-Saccade Drag-to-Draw Ergonomics: Non-orthogonal pointer escapes trigger 10ms micro-haptics with instant stroke re-anchoring; No-Guess edge violations prompt in-situ 2.5px micro-shakes eliminating attention-breaking banners; local 3x3 conflict filtering isolates remote errors from active path pulses.
   * Nurikabe: Left/right-click zero-latency dual dispatch, non-intrusive border-only HUD eliminating semantic color interference, strict deterministic whitelist with automatic Topological Hypothesis fallback, continuous timeline scrubber with violation bookmarks, seamless AI replay breakpoint take-over, and dual-clock Density of Thought telemetry.
   * Kropki: Standard box topology, linear dashed negative-constraint barriers, localized crosshair highlight, 8ms mechanical haptic feedback, reversible auto-notes infill, 20% pace splits.
   * Kakuro: Run-local solution spaces, blocky 180° erosion layout, clickable candidate strip, extreme sum set-closures, cross-capacity squeeze, deep modulo-9 digital root congruence filters.
   * Heyawake: BSP interlocking L-Room gear partitioning, Active Ray Blocker propagation, true branch bifurcation entropy evaluation, dual-state instantaneous switching, silent throat cut-point radar, magnetic WASD/Arrow docking.
   * Futoshiki: Knuth unbiased Latin square generation, full Naked/Hidden Pair engines, global Floyd-Warshall transit-closure cache, midgame parallel branching factor (\ge 2.4), double-click Injection Mode, endgame topological scheduler.
   * Hitori: Visual-first heuristic layer (triplet deduction, sandwich trapping), bidirectional count closure, chain-collision batch shading, \Delta\text{Domain} weighted crux entropy telemetry, 3-state pencil drafts, 50ms fast unprovable circuit breaker.
   * Light Up: Pseudo-Boolean (PB) boundary tightening, global 2-SAT Kosaraju SCC implication propagation, bidirectional symmetric reductio probes, dynamic aesthetic topology (low-tier Great Wall / high-tier island traps), Eureka flux metering, instant dual-mode dispatch, mobile Mode Stick.
   * Masyu: Self-avoiding meandering loop deformation, bidirectional black pearl extension & white pearl turning heuristics, adjacent black pearl deadlock pruning, boundary tangential self-intersection avoidance, CSP exact cover verification.
 * Clinical Proctoring & Integrity Monitoring: Integrates useAntiCheatMonitor, clinicalProctoring, and hardware input drift heuristics to ensure objective competitive fidelity.
 * Strict Tournament Mode: Completely suppresses in-game conflict glows, wave overlays, and nominal quota labels for unassisted, competition-compliant solving.
 * Zero-Trust Verification: Hard locks board generation and hints during official attempts; generates cryptographic SHA-256 receipts via Web Crypto API with constant-time equality checks.
本地開發 / Local Development
環境需求 / Prerequisites
 * Node.js: >= 20.0.0
 * npm: >= 10.0.0
 * Rust: >= 1.75.0 (含 wasm32-unknown-unknown 目標，若需修改 WASM 核心)
 * wasm-pack: >= 0.12.0
 * Python: >= 3.10 (若需使用 generator_daemon/ 批量生產種子庫)
安裝與啟動 / Setup & Run
# 1. 進入前端目錄 / Navigate to frontend
cd web-frontend

# 2. 確定性安裝相依套件 / Install dependencies
npm ci

# 3. 啟動本機開發伺服器 / Start dev server
npm run dev

# 4. 進行嚴格型別檢查與生產打包 / Production build & type-check
npm run build

構建 WebAssembly 核心 (可選) / Build WASM Core (Optional)
# 進入 Rust 核心引擎目錄 / Navigate to core engine
cd core-engine

# 編譯並優化 WASM 產物至前端目錄 / Build & optimize WASM
wasm-pack build --target web --release --out-dir ../web-frontend/src/wasm
rm -f ../web-frontend/src/wasm/.gitignore

專案目錄結構 / Directory Layout
Lawgic/
├── .github/workflows/        # 具備雙層快取之 GitHub Pages 自動化 CI/CD (deploy.yml)
├── core-engine/              # Rust 高性能計算與 WASM 模組 (Sudoku/WASM Kernel)
│   ├── Cargo.toml
│   └── src/lib.rs
├── generator_daemon/         # 離線題目工廠與 SMT 求解器守護進程 (Python)
│   ├── batch_factory.py
│   ├── maze_generator.py
│   └── smt_welder.py
├── web-frontend/
│   ├── public/               # PWA manifest、安全 Service Worker (sw.js) 與靜態圖示
│   ├── src/
│   │   ├── components/       # 18 款競速駕駛艙 (含 SudokuBoard、TentsBoard、YajilinBoard)
│   │   ├── contexts/         # 語系切換 (LanguageContext) 與無障礙支援 (AccessibilityContext)
│   │   ├── engines/          # 18 款競技級演算法 (含 BDCE-v9.1 數獨引擎與圖論分析)
│   │   ├── generated/        # 靜態種子庫與題目元數據預編譯快取 (JSON)
│   │   ├── hooks/            # useLearnerProfile、useSkyscraperGame、useAntiCheatMonitor
│   │   ├── registry/         # RendererRegistry (動態分發與容錯重試註冊中心)
│   │   ├── utils/            # 臨床監考、動態常模、密碼學簽章、金庫存儲與排行榜
│   │   ├── App.tsx           # 主儀表板、非同步時間切片生成與賽事模式路由
│   │   └── main.tsx          # 應用程式入口
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts
├── GOVERNANCE_AND_COMPLIANCE.md # 合規性審計與資料治理政策聲明
├── LICENSE                   # MIT 授權條款
└── README.md                 # 專案說明文件

隱私、家長承諾與資料治理 / Privacy & Child Safety Commitment
 * 極致本地化 (Local-First & Offline Resilience)：所有個人最佳紀錄（PB）、認知維度雷達圖與作答軌跡完全留存於瀏覽器本機 IndexedDB / LocalStorage，無伺服器側資料蒐集。
 * 兒童隱私守護 (Zero Tracking)：全站絕不使用第三方追蹤腳本（No Google Analytics, No Meta Pixel）、無 Cookie 追蹤、無跨站指紋搜集，符合 COPPA 與歐盟 GDPR-K 兒童數位隱私最高標準。
 * 純粹透明度 (Pure Auditability)：所有賽事級通關證書均由瀏覽器原生 Web Crypto API 生成不可篡改的 SHA-256 數位憑證，供家長與選手完全掌控自己的心智成長軌跡。
授權條款 / License
本專案採用 MIT License 授權開放開源社群交流使用。

