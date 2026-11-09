const roles=["产品经理助手","产品开发助手","验收助手"];
const suggestions=["帮我把一个想法变成可上线的 AI 产品","我有一个需求，帮我理清并生成 PRD","帮我把这个产品分阶段开发、验收并交付"];
state.chats??=[];
let chat=null,role=0;
const waiting=new WeakSet();
const localFile=location.protocol==="file:";
const action=(label,fn)=>{const b=el("button",label);b.type="button";b.onclick=fn;return b};
function surface(isHome){
 $("emptyProjects").hidden=true;$("documents").hidden=true;$("chatShelf").hidden=!isHome;
 markNav(isHome?"会话":"项目");
 $("landing").hidden=!isHome;$("workspace").hidden=isHome;
 if(innerWidth<=520)document.body.classList.add("collapsed");
}
function openProject(i){
 if(!state.projects.length){
   state.screen="project";state.active=-1;save();surface(false);$("workspace").hidden=true;$("emptyProjects").hidden=false;renderNavigation();return;
 }
 state.screen="project";state.active=i;viewed=Math.min(current().step,5);save();surface(false);render();
}
function renderNavigation(){
 $("projectList").replaceChildren(...state.projects.map((p,i)=>{
   const row=el("div","");row.className="project-row";
   const pick=action("▱　"+p.name,()=>openProject(i));pick.title=p.name;
   pick.setAttribute("aria-current",String(state.active===i));
   const remove=action("删除",()=>requestDeletion(p));remove.setAttribute("aria-label","删除项目 "+p.name);
   row.append(pick,remove);return row;
 }));
 $("chatList").replaceChildren(...state.chats.map(c=>action(c.messages[0],()=>openChat(c))));
 $("context").replaceChildren(new Option("确认后创建新项目",""),...state.projects.flatMap((p,i)=>p.step===0&&!p.feedback?[new Option(p.name,i)]:[]));
}
function paintChat(){
 $("greeting").textContent=chat?"项目对话":"Hi，今天有什么安排？";
 $("messages").replaceChildren(...(chat?.messages||[]).map(m=>el("p",m)));
 const area=$("intakeActions");area.replaceChildren();
 if(chat&&!chat.intake&&waiting.has(chat))area.append(el("p","正在回复…"));
 const ir=chat?.intake;
 if(ir){
   $("messages").replaceChildren(...ir.turns.map(t=>el("p",(t.role==="assistant"?"助手　":"你　")+t.text)));
   if(waiting.has(chat))area.append(el("p","助手正在整理，请稍候…"));
   else if(ir.pending)area.append(el("p",ir.error||"上一轮尚未完成。"),action("重试本轮",()=>requestTurn(chat)));
   else if(ir.confirmed)area.append(el("p","PRD 已确认"),action("继续项目当前阶段",()=>openProject(Number(chat.project))));
   else if(ir.draft!==undefined){
     const field=el("textarea","");field.id="prdDraft";field.value=ir.draft;
     const approve=action("确认 PRD，进入方案阶段",()=>confirmDraft(chat));approve.className="primary";
     approve.disabled=!field.value.trim();field.oninput=()=>{ir.draft=field.value;approve.disabled=!field.value.trim();save()};
     const label=el("label","PRD 草稿 · 待你确认");label.htmlFor=field.id;
     area.append(label,field,approve);
   }else area.append(action("根据已有回答生成 PRD",()=>submitTurn("请按已知信息生成 PRD，缺失项列为待确认。",true)));
 }
 $("composer").hidden=!!ir&&(ir.pending||ir.draft!==undefined||ir.confirmed);
 $("context").disabled=!!ir;
 $("messages").scrollTop=$("messages").scrollHeight;
 $("modes").replaceChildren(...roles.map((r,i)=>{
 const b=action(r,()=>{role=i;if(chat){chat.role=i;save()}paintChat()});
 b.disabled=!!ir&&i!==0;
 b.setAttribute("aria-pressed",String(i===role));return b}));
 $("suggest").hidden=!!chat;
 $("guide").hidden=!!chat||role!==0;
}
function openChat(selected){
 chat=selected;state.screen="chat";state.chatIndex=state.chats.indexOf(selected);save();role=chat?.role??0;surface(true);renderNavigation();
 $("context").value=chat?.project??"";$("message").value="";paintChat();
}
$("context").onchange=()=>{if(chat){chat.project=$("context").value;save()}};
function submitTurn(text,draft=false){
 if(!text.trim())return;
 if(role!==0){
   if(chat&&waiting.has(chat))return;
   if(!chat){chat={messages:[],role,project:$("context").value};state.chats.unshift(chat)}
   const c=chat;const previous=c.messages.slice(-12);
   c.messages.push(text);waiting.add(c);openChat(c);
   const context=c.project===""?[]:state.projects[Number(c.project)]?.docs.slice(0,2)||[];
   fetch("/api/discuss",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({context,history:previous,question:text,assistant:roles[role]})})
     .then(async res=>{const data=await res.json();if(!res.ok)throw Error(data.error||"模型请求失败");c.messages.push("助手　"+data.answer)})
     .catch(err=>c.messages.push("本轮未完成："+err.message))
     .finally(()=>{waiting.delete(c);save();if(chat===c)paintChat()});
   return;
 }
 if(localFile){
   const link=el("a","打开本地工作台");link.href="http://127.0.0.1:8876";
   $("notice").replaceChildren("模型服务需要本地入口。请双击「启动工作台.command」，再",link,"。");return;
 }
 if(!chat||!chat.intake){
   const context=$("context").value;
   chat={messages:[text],project:context,role:0,intake:{turns:[],base:context===""?"":state.projects[Number(context)].docs[0]}};
   state.chats.unshift(chat);
 }
 const ir=chat.intake;
 if(ir.pending||ir.draft!==undefined||ir.confirmed)return;
 ir.turns.push({role:"user",text});ir.pending=true;ir.finish=draft;
 save();openChat(chat);requestTurn(chat);
}
async function requestTurn(c){
 if(waiting.has(c))return;
 waiting.add(c);const ir=c.intake;ir.error="";if(chat===c)paintChat();
 try{
   const res=await fetch("/api/intake",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({turns:ir.turns,draft:ir.finish})});
   const data=await res.json();if(!res.ok)throw Error(data.error||"请求失败");
   if(data.draft){ir.draft=data.draft;ir.name=data.name}
   else if(data.question)ir.turns.push({role:"assistant",text:data.question});
   else throw Error("助手未返回有效内容。");
   ir.pending=false;
 }catch(e){ir.error="本轮未完成："+e.message}
 finally{waiting.delete(c);save();if(chat===c)paintChat()}
}
function confirmDraft(c){
 const ir=c.intake;if(ir.confirmed||!ir.draft?.trim())return;
 let p=state.projects[Number(c.project)];
 if(c.project===""){p=project(ir.name);state.projects.push(p);c.project=String(state.projects.length-1)}
 else if(p.step!==0||p.docs[0]!==ir.base||p.feedback){
   $("notice").textContent="原项目需求已变更。你可以将这份 PRD 保存为新项目。";
   $("intakeActions").append(action("确认为新项目",()=>{c.project="";confirmDraft(c)}));return;
 }
 p.docs[0]=ir.draft;p.step=1;
 p.history.unshift(new Date().toLocaleString()+"　PRD 已确认\n"+ir.draft);
 p.exportHint={round:p.round,title:stages[0][1]};ir.confirmed=true;openProject(Number(c.project));
}
$("composer").onsubmit=e=>{e.preventDefault();submitTurn($("message").value.trim())};
$("file").onchange=async e=>{
 const f=e.target.files[0];if(!f)return;
 try{$("message").value+=($("message").value?"\n":"")+await f.text();$("message").focus()}
 catch{$("notice").textContent="文件读取失败，请重新选择。"}e.target.value="";
};
for(const [i,text] of suggestions.entries()){
 $("suggest").append(action(text,()=>{role=[0,0,1][i];paintChat();$("message").value=text;$("message").focus()}));
}
$("newChat").onclick=()=>openChat(null);
$("add").onclick=()=>$("dialog").showModal();
$("emptyAdd").onclick=$("add").onclick;
$("cancel").onclick=()=>$("dialog").close();
$("form").onsubmit=e=>{
 e.preventDefault();const name=$("name").value.trim();if(!name)return;
 state.projects.push(project(name));$("dialog").close();$("form").reset();openProject(state.projects.length-1);
};
const agentBusy=new WeakSet();
let deleteTarget=null;
function requestDeletion(p){
 deleteTarget=p;$("deleteProject").querySelector("p").textContent="删除「"+p.name+"」及其阶段文档、任务、项目记录和关联会话？需要留存的文档请先导出。";
 $("deleteProject").showModal();$("cancelDelete").focus();
}
$("cancelDelete").onclick=()=>$("deleteProject").close();
$("deleteProject").onclose=()=>{deleteTarget=null};
$("applyDelete").onclick=()=>{
 const index=state.projects.indexOf(deleteTarget);if(index<0)return;
 const active=current(),remembered=state.chats[state.chatIndex];
 state.projects.splice(index,1);
 state.chats=state.chats.filter(c=>c.project==="" || c.project==null || Number(c.project)!==index);
 for(const c of state.chats)if(c.project!==""&&Number(c.project)>index)c.project=String(Number(c.project)-1);
 if(!state.chats.includes(chat))chat=null;
 state.chatIndex=state.chats.indexOf(remembered);
 const kept=state.projects.indexOf(active);
 state.active=kept>=0?kept:Math.min(index,state.projects.length-1);
 if(!save()){location.reload();return}
 $("deleteProject").close();openProject(state.active);
};

function confirmedDocs(p){
 const docs=new Map();
 const put=(round,stage,title,body)=>{
   if(body?.trim())docs.set(round+"|"+title,{round,stage,title,body});
 };
 // Older projects recorded confirmation snapshots as timestamped history entries.
 let round=1;
 for(const entry of [...p.history].reverse()){
   const split=entry.indexOf("　");if(split<0)continue;
   const record=entry.slice(split+1),line=record.split("\n",1)[0];
   const next=line.match(/^开启第 (\d+) 轮，/);if(next){round=Number(next[1]);continue}
   const body=record.slice(line.length+1);
   const tagged=line.match(/^第 (\d+) 轮(技术方案|开发任务清单)已确认$/);
   if(tagged){put(Number(tagged[1]),tagged[2]==="技术方案"?1:2,tagged[2],body);continue}
   if(line==="PRD 已确认"){put(round,0,stages[0][1],body);continue}
   const stage=stages.findIndex(([name])=>line===name+" 已确认");
   if(stage>=0)put(round,stage,stage===1?"技术方案":stages[stage][1],body);
 }
 for(let j=0;j<p.step;j++)put(p.round,j,j===1?"技术方案":stages[j][1],p.docs[j]);
 const list=p.taskList;
 if(list?.confirmed&&!docs.has(list.round+"|开发任务清单")){
   put(list.round,2,"开发任务清单",list.tasks.map((t,i)=>taskText(t,i,list.tasks)).concat(list.decisions.map(d=>d.question+"："+d.answer)).join("\n\n"));
 }
 return [...docs.values()].sort((a,b)=>a.round-b.round||a.stage-b.stage);
}
function downloadDocs(p,docs,bundle=false){
 const title=bundle?"已确认文档汇总":"第"+docs[0].round+"轮-"+docs[0].title;
 const text=["# "+p.name+" · "+title,...docs.map(d=>"## 第 "+d.round+" 轮 · "+d.title+"\n\n"+d.body)].join("\n\n")+"\n";
 const filename=(p.name+"-"+title).replace(/[\/:*?"<>|\\]/g,"-")+".md";
 if(desktopStore){window.webkit.messageHandlers.exportDocument.postMessage({filename,text});return}
 const url=URL.createObjectURL(new Blob([text],{type:"text/markdown;charset=utf-8"}));
 const link=document.createElement("a");link.href=url;link.download=filename;
 document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
function renderExportGuide(p){
 const box=$("exportGuide");
 const doc=p.exportHint&&confirmedDocs(p).find(d=>d.round===p.exportHint.round&&d.title===p.exportHint.title);
 box.hidden=!doc;box.replaceChildren();
 if(!doc)return;
 const visit=action("查看项目文档",()=>{
   showDocs();
   const row=$("docList").children[state.projects.indexOf(p)];
   if(row){row.focus();row.click()}
 });
 const close=action("×",()=>{delete p.exportHint;save();renderExportGuide(p)});
 close.setAttribute("aria-label","关闭导出提示");
 box.append(el("strong",doc.title+"已确认"),close,
   el("p","现在可以下载 Markdown 文件。以后也可以从左侧「文档」找到本项目的已确认版本。"),
   action("下载这份文档",()=>downloadDocs(p,[doc])),visit);
}
function openDownloads(p){
 const docs=confirmedDocs(p);
 $("downloadTitle").textContent=p.name;
 $("downloadCount").textContent=docs.length+" 份已确认文档 · Markdown 格式";
 const rows=$("downloadRows");
 rows.replaceChildren();
 for(const doc of docs){
   const row=el("div","");row.className="download-row";
   const button=action("下载",()=>downloadDocs(p,[doc]));
   button.setAttribute("aria-label","下载第 "+doc.round+" 轮"+doc.title);
   row.append(el("span",doc.title),el("small","第 "+doc.round+" 轮"),button);rows.append(row);
 }
 if(!docs.length)rows.append(el("p","项目还没有已确认的文档。确认第一份文档后，就可以在这里下载。"));
 $("downloadBundle").hidden=!docs.length;
 $("downloadBundle").onclick=()=>downloadDocs(p,docs,true);
 $("downloadBundle").title="将各轮已确认文档合并为一个 .md 文件";
 $("visitProject").onclick=()=>{$("downloads").close();openProject(state.projects.indexOf(p))};
 $("downloads").showModal();
}
$("closeDownloads").onclick=()=>$("downloads").close();
function showDocs(){
 state.screen="documents";save();surface(false);$("workspace").hidden=true;$("documents").hidden=false;markNav("文档");
 const list=$("docList");list.replaceChildren();
 for(const p of state.projects){
   const row=action("",()=>openDownloads(p));row.className="library-row project-doc-row";
   row.setAttribute("aria-haspopup","dialog");
   row.append(el("span",p.name),el("small",confirmedDocs(p).length+" 份"),el("span","查看文档 ›"));
   list.append(row);
 }
 if(!state.projects.length)list.append(el("p","创建项目后，可以在这里找到项目文档。"));
}
function markNav(label){
 for(const button of $("globalNav").children)button.setAttribute("aria-current",button.textContent===label?"page":"false");
}
const navItems=[
 ["项目","M3 7V5h6l2 2h10v12H3z",()=>openProject(state.active)],
 ["会话","M3 4h18v13H9l-5 4v-4H3z",()=>openChat(chat)],
 ["文档","M6 3h8l4 4v14H6z M13 3v5h5 M9 12h6 M9 16h6",showDocs]
];
for(const [label,path,go] of navItems){
 const btn=action(label,go);
 const icon=document.createElementNS("http://www.w3.org/2000/svg","svg");
 icon.setAttribute("viewBox","0 0 24 24");icon.setAttribute("aria-hidden","true");
 const line=document.createElementNS(icon.namespaceURI,"path");line.setAttribute("d",path);icon.append(line);
 btn.prepend(icon);$("globalNav").append(btn);
}
function renderOutline(p){
 const text=p.docs[viewed]||"";
 const headings=Array.from(text.matchAll(/^#{1,4} +(.+)$/gm));
 const list=$("outline");
 list.replaceChildren(...headings.map(match=>action(match[1],()=>{
   const field=$("planDraft")||$("artifact");
   if(!field)return;
   const offset=field.value.indexOf(match[0]);if(offset<0)return;
   field.focus();field.setSelectionRange(offset,offset+match[0].length);
   field.scrollTop=field.scrollHeight*offset/Math.max(1,field.value.length);
 })));
 if(!headings.length)list.append(el("small",text?"当前文档未使用章节标题":"生成文档后显示章节"));
}
function renderDesk(p){
 const tabs=Array.from(new Set([0,1,viewed]));
 $("tabstrip").replaceChildren(...tabs.map(j=>{
   const tab=action(["需求 PRD","技术方案","开发记录","界面验收","发布验证","交付记录"][j],()=>{viewed=j;render()});
   tab.setAttribute("aria-pressed",String(j===viewed));return tab;
 }));
 renderDiscussion(p);
}

function discussionMessage(role, text) {
 const row = el("div", "");
 row.className = "discussion-turn " + role;
 const label = el("span", {user:"你", assistant:"方案助手", status:"对话状态"}[role]);
 label.className = "discussion-speaker";
 const body = el("div", text);
 body.className = "discussion-text";
 row.append(label, body);
 return row;
}

let displayedDiscussion = null;
function renderDiscussion(p, scrollMode) {
 const log = $("agentMessages");
 const turns = p.discussion || [];
 const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 28;
 const previousTop = log.scrollTop;
 const newProject = displayedDiscussion !== p;
 displayedDiscussion = p;
 const rows = turns.map(turn => discussionMessage(turn.role, turn.text));
 if (agentBusy.has(p)) {
   rows.push(discussionMessage("assistant", "正在回复…"));
 } else if (turns.at(-1)?.role === "user") {
   rows.push(discussionMessage("status", "上次回复已中断，可以重新发送问题。"));
 } else if (!turns.length) {
   rows.push(discussionMessage("assistant", "可以问我这份需求还有哪些待确认项，或请我解释方案中的技术选择。"));
 }
 log.replaceChildren(...rows);
 if (scrollMode === "reply" && atBottom) {
   log.scrollTop = log.lastElementChild.offsetTop;
 } else if (newProject || atBottom || scrollMode === "send") {
   log.scrollTop = log.scrollHeight;
 } else {
   log.scrollTop = previousTop;
 }
 $("agentInput").value = p.question || "";
 $("ask").disabled = agentBusy.has(p);
}
$("agentInput").oninput=()=>{current().question=$("agentInput").value;save()};
$("agentForm").onsubmit = async event => {
 event.preventDefault();
 const p = current();
 const question = $("agentInput").value.trim();
 if (!question || agentBusy.has(p)) return;
 p.discussion ??= [];
 const history = p.discussion.filter(turn => turn.role !== "status").slice(-10);
 p.discussion.push({role:"user", text:question});
 p.question = "";
 agentBusy.add(p);
 save();
 renderDiscussion(p, "send");
 try {
   const res = await fetch("/api/discuss", {method:"POST", headers:{"Content-Type":"application/json"},
     body:JSON.stringify({context:p.docs.slice(0,2), tasks:p.taskList?.round===p.round?p.taskList:undefined, history, question})});
   const data = await res.json();
   if (!res.ok || typeof data.answer !== "string" || !data.answer.trim()) throw Error(data.error || "没有收到回复。");
   p.discussion.push({role:"assistant", text:data.answer});
 } catch (error) {
   p.discussion.push({role:"status", text:"回复失败。"+error.message});
   if (!p.question) p.question = question;
 } finally {
   agentBusy.delete(p);
   save();
   if (current() === p) renderDiscussion(p, "reply");
 }
};
$("libraryToggle").onclick=()=>{$("catalogBody").hidden=!$("catalogBody").hidden};
let connection={selected:"codex",model:"",base:""};
let loginTimer=0;
const connectionName=()=>connection.selected==="api"?connection.model:"Codex";
async function connectionRequest(action,values={}){
 if(localFile)throw Error("请从本机工作台服务打开页面。");
 const response=await fetch("/api/connection",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action,...values})});
 const result=await response.json();if(!response.ok)throw Error(result.error||"连接失败。");return result;
}
function updateConnection(value){
 connection=value;
 document.querySelector("[data-config=model]").textContent="◇　模型："+connectionName()+" ⌄";
 renderModelSelect($("composerModel"));
}
const config=$("config");
const connectionBody=el("section","");
const connectionNote=config.querySelector("p");
connectionNote.setAttribute("role","status");config.insertBefore(connectionBody,connectionNote);
function configInput(form,label,type,value=""){
 const box=el("label",label);const input=document.createElement("input");
 input.required=true;input.type=type;input.value=value;input.autocomplete="off";box.append(input);form.append(box);return input;
}
const modelCatalog=[
 {provider:"DeepSeek",base:"https://api.deepseek.com",models:[["deepseek-flash","DeepSeek Flash"],["deepseek-v4-pro","DeepSeek V4 Pro"]]},
 {provider:"阿里云百炼（北京）",base:"https://dashscope.aliyuncs.com/compatible-mode/v1",models:[["qwen-plus","通义千问 Plus"]]},
 {provider:"智谱开放平台",base:"https://open.bigmodel.cn/api/paas/v4",models:[["glm-5.3","GLM-5.3"],["glm-5.3-flash","GLM-5.3 Flash"]]},
 {provider:"MiniMax（国际站）",base:"https://api.minimax.io/v1",models:[["MiniMax-M3.1-Flash","MiniMax M3.1 Flash"]]},
 {provider:"Mistral AI",base:"https://api.mistral.ai/v1",models:[["mistral-small-latest","Mistral Small"],["mistral-large-latest","Mistral Large"]]},
 {provider:"Groq",base:"https://api.groq.com/openai/v1",models:[["openai/gpt-oss-120b","GPT-OSS 120B"]]},
 {provider:"OpenAI",base:"https://api.openai.com/v1",models:[["gpt-5-mini","GPT-5 mini"]]},
 {provider:"Google AI Studio",base:"https://generativelanguage.googleapis.com/v1beta/openai",models:[["gemini-3.8-flash","Gemini 3.8 Flash"]]}
];
function renderModelSelect(select){
 const active=connection.selected==="api"?connection.connectionId:"codex";
 select.replaceChildren(new Option("Codex","codex"));
 const profiles=connection.profiles||[];
 for(const [index,item] of profiles.entries()){
   const provider=modelCatalog.find(p=>p.base===item.base)?.provider||new URL(item.base).host;
   const duplicate=profiles.filter(p=>p.model===item.model&&p.base===item.base).length>1;
   const label=provider+" · "+item.model+(duplicate?"（连接 "+(index+1)+"）":"");
   select.add(new Option(label,item.id));
 }
 select.add(new Option("＋ 接入其他模型…","add"));
 select.value=active;
 select.title=select.selectedOptions[0]?.textContent||"切换模型";
}
async function selectModel(select){
 const target=select.value;
 renderModelSelect(select);
 if(target==="add"){await openConfig("key");return}
 select.disabled=true;
 try{
   if(target==="codex"&&!(await connectionRequest("login-status")).signed){await openConfig("login");return}
   const value=await connectionRequest("select",target==="codex"?{mode:"codex"}:{mode:"api",connectionId:target});
   updateConnection(value);
   if(config.open)connectionNote.textContent="已切换到 "+connectionName()+"。";
 }catch(err){if(config.open)showError(err);else $("notice").textContent=err.message}
 finally{renderModelSelect(select);select.disabled=false}
}
$("composerModel").onchange=e=>selectModel(e.currentTarget);
window.addEventListener("focus",()=>{if(!localFile&&!config.open&&!$("composerModel").disabled)connectionRequest("status").then(updateConnection).catch(()=>{})});
function modelPicker(form){
 const label=el("label","选择服务商与模型");
 const list=document.createElement("select");list.size=6;list.className="model-picker";
 label.append(list);form.append(label);
 for(const provider of modelCatalog){
   const group=document.createElement("optgroup");group.label=provider.provider;
   for(const [id,name] of provider.models){
     const option=new Option(name,id);option.dataset.base=provider.base;
     group.append(option);
   }
   list.append(group);
 }
 list.add(new Option("其他 · 自定义兼容接口","custom"));
 const existing=Array.from(list.options).find(opt=>opt.value===connection.model&&opt.dataset.base===connection.base.replace(/\/+$/,""));
 list.value=existing?.value||(connection.base?"custom":list.options[0].value);
 return list;
}
let dialogVersion=0;
async function openConfig(page){
 const version=++dialogVersion;
 clearTimeout(loginTimer);connectionBody.replaceChildren();connectionNote.textContent="";
 config.querySelector("h2").textContent={key:"连接其他模型",model:"模型连接",login:"Codex 登录",settings:"工作台设置"}[page];
 if(!config.open)config.showModal();
 try{
   updateConnection(await connectionRequest("status"));
   if(version!==dialogVersion||!config.open)return;
   if(page==="key"){
     const form=el("form","");
     const picker=modelPicker(form);
     const custom=el("div","");custom.className="custom-endpoint";form.append(custom);
     const base=configInput(custom,"API 根地址（Chat Completions 兼容）","url",connection.base);
     base.placeholder="https://api.example.com/v1";
     const model=configInput(custom,"模型 ID","text",connection.model);
     const secret=configInput(form,"API Key","password");
     let lastTarget=null;
     function syncPicker(){
       const option=picker.selectedOptions[0];
       const manual=option.value==="custom";
       custom.hidden=!manual;base.disabled=model.disabled=!manual;
       const target=manual?"custom":option.dataset.base;
       if(lastTarget!==target)secret.value="";
       lastTarget=target;
       secret.placeholder=manual?"粘贴接口服务商的 Key":"粘贴 "+option.parentElement.label+" 的 API Key";
     }
     picker.onchange=()=>{syncPicker();connectionNote.textContent="选好模型后，粘贴对应服务商的 Key 即可测试。"};
     base.oninput=()=>{secret.value=""};
     syncPicker();
     const submit=el("button","测试并使用此模型");submit.className="primary";form.append(submit);
     connectionBody.append(form);connectionNote.textContent="发送一次简短测试请求，成功后切换。密钥仅保存在本机服务内存中，重启服务后需重新填写。";
     form.onsubmit=async e=>{
       e.preventDefault();const choice=picker.selectedOptions[0];
       const manual=choice.value==="custom";
       const payload={base:manual?base.value:choice.dataset.base,model:manual?model.value:choice.value,key:secret.value};
       submit.disabled=picker.disabled=secret.disabled=true;base.disabled=model.disabled=true;
       connectionNote.textContent="正在测试连接…";
       try{const value=await connectionRequest("configure",payload);secret.value="";updateConnection(value);
         if(version===dialogVersion)connectionNote.textContent="测试成功，已切换到 "+connectionName()+"。";
       }catch(err){if(version===dialogVersion)connectionNote.textContent=err.message}finally{submit.disabled=picker.disabled=secret.disabled=false;syncPicker()}
     };
   }else if(page==="login"){
     const refresh=async(start=false)=>{
       const result=await connectionRequest(start?"login":"login-status");
       if(version!==dialogVersion||!config.open)return;
       connectionBody.replaceChildren();connectionNote.textContent=result.signed?"本机 Codex 已登录。":result.pending?"请在系统浏览器中完成授权，完成后这里会自动更新。":result.failed?"授权未完成，可以重新登录。":"尚未登录。";
       if(result.signed)connectionBody.append(action("使用 Codex",()=>chooseMode("codex")));
       else if(!result.pending)connectionBody.append(action("打开浏览器登录",()=>refresh(true).catch(showError)));
       if(result.pending&&!result.signed)loginTimer=setTimeout(()=>refresh().catch(showError),2000);
     };
     await refresh();
   }else if(page==="model"){
     connectionNote.textContent="当前使用 "+connectionName()+"。切换后，后续消息会发送给所选服务。";
     const select=document.createElement("select");select.setAttribute("aria-label","当前模型");
     renderModelSelect(select);select.onchange=()=>selectModel(select);connectionBody.append(select);
   }else{
     connectionNote.textContent="当前模型："+connectionName()+(desktopStore?"。项目数据保存在这台 Mac 上。":"。项目数据保存在当前浏览器。");
     connectionBody.append(action("管理模型连接",()=>openConfig("model")));
   }
 }catch(err){showError(err)}
}
function showError(err){connectionNote.textContent=err.message}
async function chooseMode(mode){
 try{
   if(mode==="codex"&&!(await connectionRequest("login-status")).signed){await openConfig("login");return}
   updateConnection(await connectionRequest("select",{mode}));connectionNote.textContent="已切换到 "+connectionName()+"。";
 }catch(err){showError(err)}
}
for(const button of document.querySelectorAll("[data-config]"))button.onclick=()=>openConfig(button.dataset.config);
config.onclose=()=>{++dialogVersion;clearTimeout(loginTimer);connectionBody.replaceChildren()};
$("closeConfig").onclick=()=>config.close();
if(!localFile)connectionRequest("status").then(updateConnection).catch(()=>{});
chat=state.chats[state.chatIndex]??null;
if(state.screen==="documents")showDocs();
else if(state.screen==="chat")openChat(state.chats[state.chatIndex]??null);
else openProject(state.active);
