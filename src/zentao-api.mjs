// ZenTao API 模块
// 封装所有与禅道API相关的操作
// 兼容禅道 12.x 旧版 JSON API（非 REST API）

export class ZenTaoAPI {
  constructor(baseUrl, account, password) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.account = account;
    this.password = password;
    this.sessionId = '';
    this.sessionName = 'zentaosid';
  }

  /**
   * 透過 session 方式登入禪道
   */
  async login() {
    // 1. 取得 session ID
    const sessionResp = await fetch(`${this.baseUrl}/api-getsessionid.json`);
    if (!sessionResp.ok) {
      throw new Error(`Get session failed: ${sessionResp.status}`);
    }
    const sessionData = await sessionResp.json();
    const session = typeof sessionData.data === 'string' ? JSON.parse(sessionData.data) : sessionData.data;
    this.sessionId = session.sessionID;
    this.sessionName = session.sessionName || 'zentaosid';

    // 2. 用 session cookie 登入
    const loginResp = await fetch(`${this.baseUrl}/user-login.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': `${this.sessionName}=${this.sessionId}`
      },
      body: `account=${encodeURIComponent(this.account)}&password=${encodeURIComponent(this.password)}&keepLogin=1`,
      redirect: 'manual'
    });

    const loginText = await loginResp.text();
    let loginJson;
    try { loginJson = JSON.parse(loginText); } catch { loginJson = {}; }

    if (loginJson.status === 'failed') {
      throw new Error(`Login failed: ${loginJson.reason || loginText}`);
    }

    console.log('Login success via session API');
    return this.sessionId;
  }

  /**
   * 取得帶 session cookie 的請求選項
   */
  getAuthHeaders() {
    return {
      'Content-Type': 'application/json',
      'Cookie': `${this.sessionName}=${this.sessionId}`
    };
  }

  /**
   * 解析禪道 12.x 舊版 API 回傳格式
   * 舊版格式：{"status":"success","data":"<JSON字串>"}
   * data 欄位是被轉義的 JSON 字串，需要二次解析
   */
  parseOldApiResponse(json) {
    if (json.status === 'success' && typeof json.data === 'string') {
      return JSON.parse(json.data);
    }
    if (json.status === 'success' && typeof json.data === 'object') {
      return json.data;
    }
    // 如果不是舊版格式，直接回傳
    return json;
  }

  /**
   * 發送 GET 請求並解析舊版 API 回應
   */
  async fetchOldApi(path) {
    const resp = await fetch(`${this.baseUrl}/${path}`, {
      headers: this.getAuthHeaders()
    });
    if (!resp.ok) {
      throw new Error(`GET /${path} failed: ${resp.status}`);
    }
    const json = await resp.json();
    return this.parseOldApiResponse(json);
  }

  /**
   * 發送 POST 請求並解析舊版 API 回應
   */
  async postOldApi(path, body) {
    const resp = await fetch(`${this.baseUrl}/${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': `${this.sessionName}=${this.sessionId}`
      },
      body
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`POST /${path} failed: ${resp.status} ${text}`);
    }

    // 禪道部分寫入操作（如 bug-resolve）成功後返回 HTML 重定向而非 JSON
    const contentType = resp.headers.get('content-type') || '';
    const text = await resp.text();

    if (contentType.includes('text/html') || text.trimStart().startsWith('<html')) {
      // 從重定向腳本中提取目標路徑，視為操作成功
      const redirectMatch = text.match(/parent\.location='([^']+)'/);
      return { success: true, redirect: redirectMatch?.[1] || null };
    }

    let json;
    try { json = JSON.parse(text); } catch {
      throw new Error(`POST /${path} returned unexpected body: ${text.slice(0, 200)}`);
    }
    return this.parseOldApiResponse(json);
  }

  /**
   * 搜索产品
   * 使用舊版 API: /product-all.json
   * @param {string} keyword - 搜索关键词
   * @param {number} limit - 返回数量限制
   * @returns {Promise<Array>} 产品列表
   */
  async searchProducts(keyword = '', limit = 20) {
    const data = await this.fetchOldApi('product-all.json');

    // 舊版回傳格式：data.products 是 {id: name} 的物件
    const productsMap = data.products || {};
    let list = Object.entries(productsMap).map(([id, name]) => ({
      id: Number(id),
      name
    }));

    // 模糊搜索
    if (keyword) {
      list = list.filter(p =>
        String(p.name || '').toLowerCase().includes(keyword.toLowerCase())
      );
    }

    return list.slice(0, limit);
  }

  /**
   * 获取BUG详情
   * 使用舊版 API: /bug-view-{id}.json
   * @param {number} bugId - BUG ID
   * @returns {Promise<Object>} BUG详情
   */
  async getBugDetail(bugId) {
    const data = await this.fetchOldApi(`bug-view-${bugId}.json`);

    // 舊版回傳結構：data.bug 包含 bug 物件
    const bug = data.bug || data;

    // 轉換步驟中的內部圖片引用為完整 URL
    const resolvedSteps = this.resolveStepsImages(bug.steps);
    const stepsImages = this.extractImagesFromHtml(bug.steps);

    // 提取歷史記錄（操作日誌）
    // 禪道 bug-view API 回傳 data.actions 包含所有流轉記錄
    const actions = this.extractBugActions(data.actions);

    return {
      id: bug.id,
      title: bug.title,
      severity: bug.severity,
      priority: bug.pri,
      status: bug.status,
      steps: resolvedSteps,
      stepsImages,
      assignedTo: bug.assignedTo,
      openedBy: bug.openedBy,
      product: bug.product,
      type: bug.type,
      actions
    };
  }

  /**
   * 提取 Bug 歷史記錄（操作日誌）
   * 禪道 actions 格式：陣列或物件，每筆包含 action、actor、date、comment 等
   * @param {Object|Array} rawActions - 原始 actions 資料
   * @returns {Array} 格式化的歷史記錄
   */
  extractBugActions(rawActions) {
    if (!rawActions) return [];

    // actions 可能是物件（以 ID 為 key）或陣列
    const actionList = Array.isArray(rawActions)
      ? rawActions
      : Object.values(rawActions);

    return actionList.map(a => {
      const entry = {
        id: a.id,
        action: a.action,
        actor: a.actor,
        date: a.date
      };

      // 備註 / 留言內容
      if (a.comment) {
        entry.comment = a.comment;
      }

      // 額外欄位（如解決方案）
      if (a.extra) {
        entry.extra = a.extra;
      }

      // 子操作歷史（欄位變更明細）
      if (a.history && (Array.isArray(a.history) ? a.history.length : Object.keys(a.history).length)) {
        const histList = Array.isArray(a.history) ? a.history : Object.values(a.history);
        entry.history = histList.map(h => ({
          field: h.field,
          old: h.old,
          new: h.new
        }));
      }

      return entry;
    });
  }

  /**
   * 搜索BUG（舊方法，保留向後相容）
   */
  async searchBugs(productId, options = {}) {
    const { keyword = '', allStatuses = false, limit = 10, assignedToMe = false } = options;
    const browseType = assignedToMe ? 'assigntome' : 'unclosed';

    const bugs = await this.browseBugs(productId, { browseType, keyword, limit });

    if (!allStatuses) {
      return bugs.filter(b => String(b.status || '').toLowerCase() === 'active');
    }
    return bugs;
  }

  /**
   * 瀏覽 BUG 列表（直接使用伺服器端 browseType 篩選）
   * URL 格式：bug-browse-{productId}-{branch}-{browseType}-{param}-{orderBy}-{recTotal}-{recPerPage}-{pageID}.json
   *
   * @param {number} productId - 產品 ID
   * @param {Object} options
   * @param {string} options.browseType - 篩選類型（assigntome / all / unclosed / openedbyme / resolvedbyme / toclosed / unresolved / unconfirmed / assigntonull / longlifebugs / postponedbugs / overduebugs / needconfirm）
   * @param {string} [options.keyword] - 標題關鍵詞（客戶端過濾）
   * @param {number} [options.limit=20] - 回傳數量上限
   * @returns {Promise<Array>}
   */
  async browseBugs(productId, options = {}) {
    const { browseType = 'assigntome', keyword = '', limit = 20 } = options;
    let allBugs = [];
    let page = 1;
    const perPage = Math.min(limit, 100);
    const maxPages = 50;

    while (allBugs.length < limit && page <= maxPages) {
      const path = `bug-browse-${productId}-0-${browseType}-0-id_desc-0-${perPage}-${page}.json`;
      const data = await this.fetchOldApi(path);
      const bugs = Array.isArray(data.bugs) ? data.bugs : [];

      if (bugs.length === 0) break;
      allBugs = allBugs.concat(bugs);
      if (bugs.length < perPage) break;
      page++;
    }

    // 僅在有關鍵詞時做客戶端過濾
    if (keyword) {
      const kw = keyword.toLowerCase();
      allBugs = allBugs.filter(b =>
        String(b.title || '').toLowerCase().includes(kw)
      );
    }

    return allBugs.slice(0, limit);
  }

  /**
   * 瀏覽 BUG 並回傳總數（使用伺服器端分頁資訊）
   */
  async browseBugsWithTotal(productId, options = {}) {
    const { browseType = 'assigntome' } = options;
    const path = `bug-browse-${productId}-0-${browseType}-0-id_desc-0-20-1.json`;
    const data = await this.fetchOldApi(path);
    const bugs = Array.isArray(data.bugs) ? data.bugs : [];
    const total = data.pager?.recTotal ? Number(data.pager.recTotal) : bugs.length;

    return {
      total,
      hasMore: total > bugs.length,
      bugs: bugs.map(b => ({
        id: b.id,
        title: b.title,
        severity: b.severity,
        status: b.status,
        assignedTo: b.assignedTo
      }))
    };
  }

  /**
   * 检索第一个激活的BUG（使用generator）
   */
  async* searchFirstActiveBugGenerator(productId, options = {}) {
    const { keyword = '', assignedToMe = false } = options;
    const browseType = assignedToMe ? 'assigntome' : 'unclosed';
    let page = 1;
    const perPage = 50;
    const maxPages = 50;

    while (page <= maxPages) {
      const path = `bug-browse-${productId}-0-${browseType}-0-id_desc-0-${perPage}-${page}.json`;
      const data = await this.fetchOldApi(path);
      const bugs = Array.isArray(data.bugs) ? data.bugs : [];

      if (bugs.length === 0) break;

      for (const bug of bugs) {
        const isActive = String(bug.status || '').toLowerCase() === 'active';
        if (!isActive) continue;

        if (keyword) {
          const kw = String(keyword).toLowerCase();
          if (!String(bug.title || '').toLowerCase().includes(kw)) continue;
        }

        yield {
          id: bug.id,
          title: bug.title,
          severity: bug.severity,
          status: bug.status,
          assignedTo: bug.assignedTo
        };
      }

      if (bugs.length < perPage) break;
      page++;
    }
  }

  /**
   * 检索第一个激活的BUG
   */
  async searchFirstActiveBug(productId, options = {}) {
    const generator = this.searchFirstActiveBugGenerator(productId, options);
    for await (const bug of generator) {
      return bug;
    }
    return null;
  }

  /**
   * 检索BUG总数和第一页数据
   */
  async searchBugsWithTotal(productId, options = {}) {
    const { keyword = '', activeOnly = false, assignedToMe = false } = options;
    const browseType = assignedToMe ? 'assigntome' : 'unclosed';

    const path = `bug-browse-${productId}-0-${browseType}-0-id_desc-0-20-1.json`;
    const data = await this.fetchOldApi(path);
    let bugs = Array.isArray(data.bugs) ? data.bugs : [];

    if (keyword) {
      const kw = String(keyword).toLowerCase();
      bugs = bugs.filter(b =>
        String(b.title || '').toLowerCase().includes(kw)
      );
    }

    let filteredBugs = bugs;
    if (activeOnly) {
      filteredBugs = bugs.filter(b =>
        String(b.status || '').toLowerCase() === 'active'
      );
    }

    // 舊版 API 分頁資訊在 data.pager 中
    const total = data.pager?.recTotal ? Number(data.pager.recTotal) : filteredBugs.length;

    return {
      total,
      hasMore: total > filteredBugs.length,
      bugs: filteredBugs.map(b => ({
        id: b.id,
        title: b.title,
        severity: b.severity,
        status: b.status,
        assignedTo: b.assignedTo
      }))
    };
  }

  /**
   * 將步驟 HTML 中的圖片引用轉換為完整 URL
   * 處理兩種格式：
   * 1. 禪道內部引用：{39732.png} → http://host/zentao/file-read-39732.png
   * 2. 伺服器相對路徑：/zentao/file-read-39732.png → http://host/zentao/file-read-39732.png
   */
  resolveStepsImages(htmlContent) {
    if (!htmlContent || typeof htmlContent !== 'string') {
      return htmlContent;
    }

    // 從 baseUrl 中提取 origin（如 http://your-zentao.com）
    let origin;
    try { origin = new URL(this.baseUrl).origin; } catch {
      return htmlContent; // baseUrl 格式不合法，原樣回傳
    }

    let result = htmlContent;

    // 1. 替換 {數字.副檔名} 格式
    result = result.replace(
      /\{(\d+)\.(png|jpg|jpeg|gif|bmp|webp)\}/gi,
      (_, fileId, ext) => `${this.baseUrl}/file-read-${fileId}.${ext}`
    );

    // 2. 替換 src 中的相對路徑為完整 URL
    result = result.replace(
      /src\s*=\s*["'](\/[^"']+)["']/gi,
      (match, path) => `src="${origin}${path}"`
    );

    return result;
  }

  /**
   * 从HTML内容中提取图片完整URL
   */
  extractImagesFromHtml(htmlContent) {
    if (!htmlContent || typeof htmlContent !== 'string') {
      return [];
    }

    // 先轉換所有圖片引用為完整 URL
    const resolved = this.resolveStepsImages(htmlContent);

    const imgRegex = /<img[^>]+src\s*=\s*["']([^"']+)["'][^>]*>/gi;
    const images = [];
    let match;

    while ((match = imgRegex.exec(resolved)) !== null) {
      const src = match[1];
      if (src) {
        images.push(src);
      }
    }

    return images;
  }

  /**
   * 通过产品名称获取一个BUG的详情
   */
  async getBugByProductName(productName, options = {}) {
    const { keyword = '' } = options;

    const products = await this.searchProducts(productName, 10);
    if (products.length === 0) {
      throw new Error(`未找到产品: ${productName}`);
    }

    if (products.length > 1) {
      const productList = products.map((p, index) =>
        `${index + 1}. ${p.name} (ID: ${p.id})`
      ).join('\n');

      throw new Error(`找到多个匹配的产品，请选择其中一个：\n${productList}\n\n请使用更精确的产品名称重新查询。`);
    }

    const product = products[0];
    const bug = await this.searchFirstActiveBug(product.id, {
      keyword,
      assignedToMe: true
    });

    if (!bug) {
      throw new Error(`产品 "${product.name}" 中没有指派给你的激活BUG${keyword ? `（关键词: ${keyword}）` : ''}`);
    }

    const bugDetail = await this.getBugDetail(bug.id);

    return {
      bug: bugDetail,
      product: { id: product.id, name: product.name }
    };
  }

  /**
   * 標記 BUG 為已解決
   * 使用舊版 API: /bug-resolve-{id}.json
   *
   * resolution 可選值（來自禪道表單）：
   *   fixedcodeerror    - 已解決（代碼欠缺或錯誤）
   *   fixeddesigndefect - 已解決（文檔設計缺失）
   *   fixeduierror      - 已解決（UI 樣式問題）
   *   fixedwrongdata    - 已解決（早期錯誤數據）
   *   fixedsettingerror - 已解決（設置錯誤或配置問題）
   *   fixedcognitiveerror - 已解決（認知錯誤）
   *   fixednew          - 已解決（新需求）
   *   fixedbetteruse    - 已解決（優化）
   *   bydesign          - 設計如此
   *   duplicate         - 重複 Bug
   *   external          - 外部原因
   *   notrepro          - 無法重現
   *   postponed         - 延期處理
   *   willnotfix        - 不予解決
   *
   * @param {number} bugId - Bug ID
   * @param {Object} options - 解決選項
   * @param {string} options.resolution - 解決方案（預設 fixedcodeerror）
   * @param {string} [options.comment] - 備註說明
   * @param {string} [options.resolvedBuild] - 解決版本（如 trunk）
   * @param {string} [options.resolvedDate] - 解決日期（格式：YYYY-MM-DD HH:mm:ss）
   * @param {string} [options.assignedTo] - 解決後指派給（用戶帳號）
   * @param {number} [options.duplicateBug] - 重複 Bug ID（resolution=duplicate 時必填）
   */
  async markBugResolved(bugId, options = {}) {
    const {
      resolution = 'fixedcodeerror',
      comment = '',
      resolvedBuild = 'trunk',
      resolvedDate = '',
      assignedTo = '',
      duplicateBug,
    } = options;

    const params = new URLSearchParams();
    params.set('resolution', resolution);
    params.set('resolvedBuild', resolvedBuild);

    if (comment) params.set('comment', comment);
    if (resolvedDate) params.set('resolvedDate', resolvedDate);
    if (assignedTo) params.set('assignedTo', assignedTo);
    if (resolution === 'duplicate' && duplicateBug) {
      params.set('duplicateBug', String(duplicateBug));
    }

    const data = await this.postOldApi(`bug-resolve-${bugId}.json`, params.toString());
    return data;
  }

  /**
   * 抓取禪道檔案（圖片等），回傳 Buffer 及 MIME 類型
   * @param {string} fileUrl - 完整 URL 或 file-read-{id}.{ext} 路徑
   * @returns {Promise<{buffer: Buffer, mimeType: string}>}
   */
  async fetchFile(fileUrl) {
    // 若傳入相對路徑，補全為完整 URL
    let url = fileUrl;
    if (!url.startsWith('http')) {
      url = url.startsWith('/') ? `${new URL(this.baseUrl).origin}${url}` : `${this.baseUrl}/${url}`;
    }

    const resp = await fetch(url, {
      headers: { 'Cookie': `${this.sessionName}=${this.sessionId}` },
      redirect: 'follow'
    });

    if (!resp.ok) {
      throw new Error(`Fetch file failed: ${resp.status} ${url}`);
    }

    const contentType = resp.headers.get('content-type') || 'application/octet-stream';
    const contentLength = resp.headers.get('content-length');
    if (contentLength && Number(contentLength) > 10 * 1024 * 1024) {
      throw new Error(`File too large: ${contentLength} bytes`);
    }
    const arrayBuffer = await resp.arrayBuffer();
    return { buffer: Buffer.from(arrayBuffer), mimeType: contentType };
  }

  /**
   * 智能搜索产品和BUG
   */
  async searchProductBugs(keyword, options = {}) {
    const { bugKeyword = '', productId, allStatuses = false, assignedToMe = false } = options;

    if (productId) {
      if (!Number.isFinite(productId)) {
        throw new Error('productId 必須為數字');
      }

      const bugs = await this.searchBugs(productId, {
        keyword: bugKeyword,
        allStatuses,
        assignedToMe
      });

      return { bugs };
    }

    const products = await this.searchProducts(keyword);

    if (products.length === 1) {
      const product = products[0];
      const bugs = await this.searchBugs(product.id, {
        keyword: bugKeyword,
        allStatuses,
        assignedToMe
      });

      return { product, bugs };
    }

    return { products };
  }

  /**
   * 搜索所有产品的BUG
   */
  async searchAllProductsBugs(options = {}) {
    const { keyword = '', allStatuses = false, limit = 10, assignedToMe = false } = options;

    const products = await this.searchProducts('', 50);
    let allBugs = [];

    for (const product of products) {
      try {
        const bugs = await this.searchBugs(product.id, {
          keyword,
          allStatuses,
          limit: Math.ceil(limit / products.length) + 5,
          assignedToMe
        });

        const bugsWithProduct = bugs.map(bug => ({
          ...bug,
          product: { id: product.id, name: product.name }
        }));

        allBugs = allBugs.concat(bugsWithProduct);
      } catch (err) {
        console.warn(`Failed to search bugs for product ${product.id}: ${err.message}`);
      }
    }

    allBugs.sort((a, b) => (b.severity || 0) - (a.severity || 0));

    return allBugs.slice(0, limit);
  }
}
