// Loaded only by the public web entry. Credentials live for this tab's lifetime.
window.hostedWorkbench = (() => {
  const profiles = new Map();
  let selected = null;
  const questions = [
    "谁会用这个产品？他们最先需要解决什么问题？",
    "用户会如何完成核心操作？请给出一个能验收的具体例子。",
    "数据要保存在哪里？首版有哪些范围或费用限制？"
  ];
  function status() {
    const active = profiles.get(selected);
    return {selected: active ? "api" : "guide", connectionId: selected, model: active?.model || "",
      base: active?.base || "", profiles: Array.from(profiles, ([id, {base, model}]) => ({id, base, model}))};
  }
  async function message(profile, prompt) {
    let response;
    try {
      response = await fetch(profile.base + "/chat/completions", {
        method: "POST", credentials: "omit", redirect: "error", referrerPolicy: "no-referrer",
        signal: AbortSignal.timeout(120000),
        headers: {"Content-Type": "application/json", Authorization: "Bearer " + profile.key},
        body: JSON.stringify({model: profile.model, messages: [{role:"user",content:prompt}]})
      });
    } catch (error) {
      if (error.name === "TimeoutError") throw Error("模型响应超时，请稍后重试。");
      throw Error("浏览器无法连接模型，请检查网络，并确认接口允许跨域请求（CORS）。");
    }
    if (!response.ok) throw Error("模型服务返回 HTTP " + response.status + "，请检查模型、Key 和额度。");
    const answer = (await response.json()).choices?.[0]?.message?.content;
    if (typeof answer !== "string" || !answer.trim()) throw Error("模型没有返回有效文本。");
    return answer.trim();
  }
  async function connection(data) {
    if (data.action === "configure") {
      const url = new URL(data.base.trim());
      if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw Error("请输入服务商的 HTTPS 接口根地址。");
      const profile = {base:url.href.replace(/\/+$/, ""), model:data.model.trim(), key:data.key.trim()};
      if (!profile.model || !profile.key) throw Error("请填写模型和 Key。");
      await message(profile, "连接检查，只回复 OK。");
      const same = Array.from(profiles).find(([, p]) => p.base === profile.base && p.model === profile.model && p.key === profile.key);
      selected = same?.[0] || crypto.randomUUID();
      profiles.set(selected, profile);
    } else if (data.action === "select") {
      if (data.mode !== "guide" && !profiles.has(data.connectionId)) throw Error("请重新连接这个模型。");
      selected = data.mode === "guide" ? null : data.connectionId;
    } else if (data.action !== "status") throw Error("Codex 登录请使用桌面版。");
    return status();
  }
  function asJSON(text) {
    try { return JSON.parse(text.replace(/^\x60\x60\x60(?:json)?\s*|\s*\x60\x60\x60$/gi, "")); }
    catch { throw Error("模型没有返回所需的文档格式，请重试。"); }
  }
  function validText(value) { return typeof value === "string" && Boolean(value.trim()); }
  function taskList(tasks, decisions) {
    if (!Array.isArray(tasks) || !tasks.length || tasks.length > 20 || !Array.isArray(decisions) ||
        !decisions.every(validText)) throw Error("任务清单格式不完整，请重试。");
    tasks.forEach((task, i) => {
      if (!task || !["title","basis","input","output","acceptance"].every(k => validText(task[k])) ||
          !Array.isArray(task.depends) || !task.depends.every(x => Number.isInteger(x) && x >= 1 && x <= i)) {
        throw Error("任务字段或前置依赖无效，请重试。");
      }
      task.id = i + 1;
    });
    return {tasks, decisions};
  }
  async function handle(path, data) {
    if (path === "/api/connection") return connection(data);
    const model = profiles.get(selected);
    if (path === "/api/intake") {
      const turns = data.turns;
      const round = Math.floor(turns.length / 2);
      const draft = round >= 3 || (round > 0 && data.draft);
      if (model) {
        const prompt = draft ? '根据访谈整理 Markdown PRD，未确定的事项列为问题。只返回 JSON {"name":"简短产品名","draft":"PRD 正文"}。' :
          "你是产品经理，请根据已有回答追问一个澄清问题，关注" + questions[round];
        const answer = await message(model, prompt + "\n" + JSON.stringify(turns));
        if (!draft) return {question:answer};
        const result = asJSON(answer);
        if (!validText(result?.name) || !validText(result?.draft)) throw Error("PRD 缺少名称或正文，请重试。");
        return result;
      }
      if (!draft) return {question:questions[round]};
      const sections = ["产品想法", "用户与问题", "使用流程与验收", "范围与约束"];
      const answers = turns.filter(t => t.role === "user").map(t => t.text);
      if (data.draft) answers.pop(); // The UI adds a command turn when requesting an early draft.
      return {name:answers[0].slice(0,24), draft:sections.map((s,i) => "## " + s + "\n" + (answers[i] || "待确认")).join("\n\n")};
    }
    if (path === "/api/discuss") {
      if (!model) throw Error("自由对话需要连接模型。点顶部「自定义 API Key」接入后即可提问。");
      return {answer:await message(model,"你是产品项目助手。参考以下需求和历史回答当下问题，区分事实与建议。\n"+JSON.stringify(data))};
    }
    if (path === "/api/plan") {
      const plan = model ? await message(model,"根据已确认 PRD 编写中文 Markdown 技术方案，覆盖范围、架构、数据、成本、异常、验收和开发顺序。\n"+data.prd) :
        "## 需求依据\n"+data.prd+"\n\n## 技术选型\n待填写：产品形态、组件与选型理由。\n\n## 数据与权限\n待填写：数据字段、存储位置与访问权限。\n\n## 开发与验收\n待填写：首个可运行用例、预期结果和失败处理。";
      return {plan};
    }
    if (path === "/api/tasks") {
      if (!model) return taskList([{title:"实现首个核心用例",basis:"对照已确认的 PRD，填写对应需求。",input:"填写用例输入",output:"填写交付文件或功能",acceptance:"填写可复现的验收步骤与预期结果",depends:[]}],[]);
      const result = asJSON(await message(model,'根据 PRD 和技术方案给出开发清单，只返回 JSON {"tasks":[{"title":"名称","basis":"依据","input":"输入","output":"交付物","acceptance":"验收条件","depends":[]}],"decisions":[]}。depends 是前置任务序号，从 1 开始。decisions 是待决定的问题字符串数组。\n'+JSON.stringify(data)));
      return taskList(result?.tasks,result?.decisions);
    }
    throw Error("请在桌面版执行本机开发任务。");
  }
  return async (path, options) => {
    try { return Response.json(await handle(path, JSON.parse(options.body))); }
    catch (error) { return Response.json({error:error.message},{status:400}); }
  };
})();
