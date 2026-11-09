
const stages=[
 ["想法与需求","产品需求文档（PRD）","写清谁会使用、要解决的问题，以及怎样判断第一版做到位。"],
 ["方案与适配","架构方案与技术适配声明","对照需求，核对组件选型、外部服务、费用和本轮范围。"],
 ["核心功能","核心用例与测试证据","记录真实输入、实际输出，以及失败后如何恢复。"],
 ["界面体验","界面走查记录","从新建项目走到验收，检查导航、反馈和中断恢复。"],
 ["发布验证","安装与运行记录","按产品选定的交付形式验收。桌面产品需验证安装、独立启动、退出和重开。"],
 ["交付与迭代","交付清单与遗留问题","核对产物位置、使用说明和已知问题，决定下一轮需求。"]
];
const samplePrd="使用者：独立产品制作者。\n目标：在同一项目内把点子变成可验收的产品。\n验收：重新打开工作台后能继续上次的阶段。";
const $=id=>document.getElementById(id);
const el=(tag,value)=>{const node=document.createElement(tag);node.textContent=value;return node};
function project(name){return {name,step:0,round:1,docs:stages.map(()=>""),feedback:"",history:[]}}
const sample=project("个人产品工作台 · 示例");Object.assign(sample,{step:1});sample.docs[0]=samplePrd;sample.history.push("示例需求已确认");
const key="product-workbench-preview-v1";
const desktopStore=window.desktopWorkspace;
let lastSaved;
try { lastSaved=desktopStore ? desktopStore.load() : localStorage.getItem(key); }
catch (error) { $("notice").textContent="工作区读取失败，请重新打开。 "+error.message; throw error; }
let state=JSON.parse(lastSaved||"null")||{projects:[sample],active:0};
const current=()=>state.projects[state.active];
let viewed=Math.min(current()?.step??0,5);
function save(){try{if(!desktopStore && localStorage.getItem(key)!==lastSaved){$("notice").textContent="另一窗口已修改项目数据。请刷新后继续。";return false}const raw=JSON.stringify(state);if(desktopStore)desktopStore.save(raw);else localStorage.setItem(key,raw);lastSaved=raw;$("notice").textContent="";return true}catch(error){$("notice").textContent="保存失败，请先复制当前内容。 "+error.message;return false}}
function log(msg){current().history.unshift(new Date().toLocaleString()+"　"+msg)}
function render(){
 const p=current(),stage=stages[viewed],active=p.step===viewed;
 renderNavigation();renderDesk(p);
 $("title").textContent=p.name;$("summary").textContent="第 "+p.round+" 轮　·　已确认 "+p.step+" / 6 个阶段";$("progress").max=6;$("progress").value=p.step;
 $("rail").replaceChildren(...stages.map(([name],i)=>{const b=el("button",name);b.append(el("small",i<p.step?"已确认":i===p.step?"当前":"待开始"));b.classList.toggle("selected",i===viewed);b.onclick=()=>{viewed=i;render()};return b}));
 const panel=$("panel");panel.replaceChildren(el("span",active?(p.feedback?"待修改":"待审阅"):viewed<p.step?"已确认":"待开始"),el("h2",stage[0]),el("p",stage[2]));panel.firstChild.className="tag";
 if(viewed>p.step){
   panel.append(el("p","完成「"+stages[p.step][0]+"」后，按顺序进入后续阶段。"),
     action("回到当前阶段",()=>{viewed=p.step;render()}));
 }else if(active && viewed===1){
   renderPlan(p,panel);
 }else{
   if(viewed===2 && (active || p.taskList?.round===p.round)){
     renderTaskList(p,panel);
     if(!active || (p.taskList?.execution?.status==="complete" && p.taskList.round===p.round))renderArtifact(p,stage,active,panel);
     else if(p.docs[2])panel.append(reference("已有开发记录",p.docs[2]));
   }else renderArtifact(p,stage,active,panel);
 }
 for(const doc of confirmedDocs(p).filter(d=>d.round===p.round&&d.stage===viewed))panel.append(action("导出 "+doc.title,()=>downloadDocs(p,[doc])));
 renderOutline(p);renderExportGuide(p);
 $("history").replaceChildren(...p.history.map(item=>{const li=el("li","");li.append(el("pre",item));return li}));
}

function renderArtifact(p,stage,active,panel){
 const label=el("label",stage[1]);label.htmlFor="artifact";const field=el("textarea","");field.id="artifact";field.value=p.docs[viewed];field.readOnly=!active;field.placeholder=active?"填写或粘贴本阶段产物，再进行确认。":"阶段产物将在这里显示。";panel.append(label,field);
 if(active){
 if(p.feedback)panel.append(el("p","修改意见："+p.feedback));
 const actions=el("div","");actions.className="actions";const approve=el("button",p.feedback?"提交修改，重新审阅":"确认本阶段"+(viewed===5?"并完成交付":"并继续"));approve.className="primary";actions.append(approve);
 const ready=()=>field.value.trim()&&(!p.feedback||field.value.trim()!==p.before.trim());approve.disabled=!ready();field.oninput=()=>{p.docs[viewed]=field.value;renderOutline(p);save();approve.disabled=!ready()};
 approve.onclick=()=>{if(!ready())return;if(p.feedback){log(stage[0]+" 已提交修改");p.feedback="";delete p.before}else{log(stage[0]+" 已确认\n"+field.value);p.exportHint={round:p.round,title:stage[1]};p.step++;viewed=Math.min(p.step,5)}save();render()};
 if(!p.feedback){const revise=el("button","要求修改");actions.append(revise);revise.onclick=()=>{const note=prompt("这一步需要改什么？");if(!note?.trim())return;p.feedback=note.trim();p.before=field.value;log(stage[0]+" 退回修改："+p.feedback);save();render()}}
 panel.append(actions)}
 if(p.step===6){const next=el("button","开始下一轮迭代");next.onclick=()=>{p.round++;p.step=0;viewed=0;log("开启第 "+p.round+" 轮，沿用上一轮产物草稿");save();render()};panel.append(next)}
}

function reference(title,text){
 const details=el("details","");
 details.append(el("summary",title),el("pre",text));
 return details;
}

const planRequests=new WeakSet();
function renderPlan(p,panel){
 const busy=planRequests.has(p);
 const bound=p.planSource===p.docs[0] && p.planRound===p.round;
 panel.firstChild.textContent=busy?"生成中":bound?"待你确认":"待生成";
 panel.querySelector("p").textContent=bound
   ?"先核对首版范围、费用和待确认决定。可以直接修改下方方案，满意后再进入开发。"
   :"本轮 PRD 已确认。展开核对原文，然后生成技术方案。";
 panel.append(reference("查看生成依据 · 第 "+p.round+" 轮已确认 PRD",p.docs[0]));
 if(!bound){
   if(p.docs[1])panel.append(reference("查看已有方案参考稿",p.docs[1]));
   if(localFile){
     const link=el("a","打开本地工作台");link.href="http://127.0.0.1:8876";
     panel.append(el("p","请双击「启动工作台.command」后从本地服务生成方案。"),link);return;
   }
   const generate=action(busy?"正在根据 PRD 生成…":p.planError?"重试生成技术方案":"根据已确认 PRD 生成技术方案",()=>generatePlan(p));
   generate.disabled=busy;generate.className="primary";
   if(p.planError)panel.append(el("p",p.planError));
   panel.append(generate);return;
 }
 const label=el("label","技术方案草稿");
 label.htmlFor="planDraft";
 const editor=el("textarea","");
 editor.id=label.htmlFor;editor.value=p.docs[1];
 const approve=action("确认方案，进入开发",()=>{
   if(current()!==p || p.step!==1 || !editor.value.trim())return;
   p.docs[1]=editor.value;
   log("第 "+p.round+" 轮技术方案已确认\n"+editor.value);
   p.feedback="";delete p.before;
   p.exportHint={round:p.round,title:"技术方案"};p.step=2;viewed=2;save();render();
 });
 approve.className="primary";approve.disabled=!editor.value.trim();
 editor.oninput=()=>{p.docs[1]=editor.value;approve.disabled=!editor.value.trim();renderOutline(p);save()};
 panel.append(label,editor,el("small",desktopStore?"修改会自动保存在这台 Mac 上。":"修改会自动保存在当前浏览器。"),el("div",""),approve);
}

async function generatePlan(p){
 if(p.step!==1 || planRequests.has(p))return;
 const prd=p.docs[0], round=p.round;
 planRequests.add(p);delete p.planError;render();
 try{
   const response=await fetch("/api/plan",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({prd})});
   const data=await response.json();
   if(!response.ok || typeof data.plan!=="string" || !data.plan.trim())throw Error(data.error||"未收到完整方案，请重试。");
   if(p.step!==1 || p.round!==round || p.docs[0]!==prd)return;
   if(p.docs[1])p.history.unshift("生成前的方案参考稿\n"+p.docs[1]);
   p.planSource=prd;p.planRound=round;p.docs[1]=data.plan;
 }catch(error){p.planError="生成未完成。"+error.message}
 finally{
   planRequests.delete(p);save();
   if(current()===p && !$("workspace").hidden)render();
 }
}
