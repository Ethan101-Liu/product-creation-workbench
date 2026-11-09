const taskRequests=new WeakSet();
const taskFields={title:"任务名称",basis:"需求依据",input:"输入",output:"交付物",acceptance:"验收条件"};

async function generateTasks(p){
 if(taskRequests.has(p)||p.step!==2)return;
 const round=p.round;
 taskRequests.add(p);delete p.taskError;render();
 try{
   const response=await workbenchRequest("/api/tasks",{method:"POST",headers:{"Content-Type":"application/json"},
     body:JSON.stringify({prd:p.docs[0],plan:p.docs[1]})});
   const data=await response.json();
   if(!response.ok)throw Error(data.error||"生成失败");
   if(p.step!==2||p.round!==round)return;
   p.taskList={round,tasks:data.tasks,decisions:data.decisions.map(question=>({question,answer:""})),confirmed:false};
 }catch(e){p.taskError="生成未完成："+e.message}
 finally{taskRequests.delete(p);save();if(current()===p&&!$("workspace").hidden)render()}
}

function renderTaskList(p,panel){
 const list=p.taskList?.round===p.round?p.taskList:null;
 const busy=taskRequests.has(p);
 panel.firstChild.textContent=list?(list.confirmed?"清单已确认":"待确认任务清单"):(busy?"正在拆分":"待拆分任务");
 panel.querySelector("p").textContent=list?.confirmed?"按已确认清单查看开工材料。":"先核对每项任务的需求依据、交付物和验收条件，再确认开发顺序。";
 panel.append(reference("查看本轮已确认的技术方案",p.docs[1]));
 if(!list){
   if(p.taskError)panel.append(el("p",p.taskError));
   const make=action(busy?"正在生成任务清单…":"生成开发任务清单",()=>generateTasks(p));
   make.disabled=busy;make.className="primary";panel.append(make);return;
 }
 const tasks=list.tasks;
 const confirm=action("确认任务清单",()=>{
   if(!panel.contains(confirm)||confirm.disabled||p.step!==2)return;
   list.confirmed=true;p.exportHint={round:p.round,title:"开发任务清单"};
   log("第 "+p.round+" 轮开发任务清单已确认\n"+tasks.map((t,i)=>taskText(t,i,tasks)).join("\n\n")+"\n"+list.decisions.map(d=>d.question+"："+d.answer).join("\n"));
   save();render();
 });
 const valid=()=>tasks.length && tasks.every((t,i)=>Object.keys(taskFields).every(k=>t[k].trim()) &&
   t.depends.every(id=>tasks.slice(0,i).some(prev=>prev.id===id))) && list.decisions.every(d=>d.answer.trim());
 function changed(){save();confirm.disabled=!valid()}
 if(list.confirmed){
   if(p.step===2 && hostedWeb) panel.append(el("p","网页版可在下方记录实际运行结果和验收证据。需要自动执行代码时，请使用桌面版。"));
   else if(p.step===2)renderExecution(p,list,panel);
   panel.append(reference("查看已确认的完整任务清单",tasks.map((t,i)=>taskText(t,i,tasks)).join("\n\n")));
   if(list.decisions.length)panel.append(reference("已记录的决定",list.decisions.map(d=>d.question+"："+d.answer).join("\n")));
   return;
 }
 for(const [i,t] of tasks.entries()){
   const card=el("section","");card.className="task-card";
   card.append(el("h3","任务 "+(i+1)));
   for(const [key,name] of Object.entries(taskFields)){
     const label=el("label",name),input=el(key==="title"?"input":"textarea","");
     input.value=t[key];input.oninput=()=>{t[key]=input.value;changed()};label.append(input);card.append(label);
   }
   const deps=el("fieldset","");deps.append(el("legend","前置任务"));
   if(!i)deps.append(el("small","首项无前置任务"));
   tasks.slice(0,i).forEach((prev,j)=>{
     const label=el("label","任务 "+(j+1)),box=el("input","");box.type="checkbox";box.checked=t.depends.includes(prev.id);
     box.onchange=()=>{t.depends=t.depends.filter(id=>id!==prev.id);if(box.checked)t.depends.push(prev.id);save();render()};
     label.prepend(box);deps.append(label);
   });
   const controls=el("div","");controls.className="actions";
   for(const [caption,delta] of [["上移",-1],["下移",1]]){
     const j=i+delta,other=tasks[j];
     const btn=action(caption,()=>{[tasks[i],tasks[j]]=[other,t];save();render()});
     btn.disabled=!other||(delta<0?t.depends.includes(other.id):other.depends.includes(t.id));
     if(btn.disabled&&other)btn.title="请先调整前置任务";controls.append(btn);
   }
   const del=action("删除",()=>{tasks.splice(i,1);save();render()});
   del.disabled=tasks.some(item=>item.depends.includes(t.id));if(del.disabled)del.title="请先取消其他任务对本项的依赖";
   controls.append(del);card.append(deps,controls);panel.append(card);
 }
 panel.append(action("＋ 添加任务",()=>{
   tasks.push({id:Math.max(0,...tasks.map(t=>t.id))+1,title:"",basis:"",input:"",output:"",acceptance:"",depends:[]});
   save();render();document.querySelector(".task-card:last-of-type input")?.focus();
 }));
 if(list.decisions.length)panel.append(el("h3","确认前需要你决定"));
 for(const d of list.decisions){
   const label=el("label",d.question),input=el("textarea","");input.value=d.answer;
   input.placeholder="记录你的决定";input.oninput=()=>{d.answer=input.value;changed()};label.append(input);panel.append(label);
 }
 confirm.className="primary";confirm.disabled=!valid();panel.append(confirm);
}

function taskText(t,i,tasks){
 const numbers=t.depends.map(id=>tasks.findIndex(item=>item.id===id)+1);
 return [String(i+1)+". "+t.title,...Object.entries(taskFields).filter(([k])=>k!=="title").map(([k,label])=>label+"："+t[k]),
   "前置任务："+(numbers.join("、")||"无")].join("\n");
}

const executionRequests=new WeakSet();
const executionTimers=new WeakMap();
function pollExecution(p,list){
 clearTimeout(executionTimers.get(list));
 executionTimers.set(list,setTimeout(()=>{
   if(state.projects.includes(p)&&p.taskList===list)requestExecution(p,list,"status");
 },1600));
}
async function requestExecution(p,list,op,feedback=""){
 if(!list.confirmed||p.step!==2||executionRequests.has(list))return;
 list.runId??=crypto.randomUUID();
 const old=list.execution||{status:"new",index:0,attempt:0};
 // Persist the request identity before dispatch so refresh can reattach to this run.
 list.execution={...old,checking:true};delete list.execError;
 if(!save())return;
 executionRequests.add(list);
 if(current()===p&&!$("workspace").hidden)render();
 try{
   const body={action:op,id:list.runId,index:old.index,attempt:old.attempt||0,feedback};
   if(op==="start"&&!old.index)body.inputs={confirmed:true,prd:p.docs[0],plan:p.docs[1],tasks:list.tasks,decisions:list.decisions};
   const res=await workbenchRequest("/api/execute",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
   const value=await res.json();if(!res.ok)throw Error(value.error||"执行服务未响应");
   if(!state.projects.includes(p)||p.taskList!==list)return;
   list.execution=value;
   if(value.accepted.length>(old.accepted?.length||0)){
     const record=value.accepted[value.accepted.length-1];
     const note="任务 "+value.accepted.length+" · "+list.tasks[value.accepted.length-1].title+" 已验收\n"+record.folder+"\n"+record.log;
     p.history.unshift(new Date().toLocaleString()+"　"+note);
     p.docs[2]=[p.docs[2],note].filter(Boolean).join("\n\n");
   }
   if(value.status==="running")pollExecution(p,list);
 }catch(e){list.execution=old;list.execError=e.message}
 finally{executionRequests.delete(list);save();if(current()===p&&!$("workspace").hidden)render()}
}
function renderExecution(p,list,panel){
 const run=list.execution||{status:"new",index:0,accepted:[]};
 panel.append(el("p","已验收 "+(run.accepted?.length||0)+" / "+list.tasks.length+" 项"));
 if(run.status==="complete"){
   panel.append(el("h3","本轮开发任务已全部验收"));return;
 }
 const task=list.tasks[run.index];
 panel.append(el("h3","当前任务 "+(run.index+1)+" · "+task.title),el("p","输入："+task.input),
   el("p","交付物："+task.output),el("p","验收条件："+task.acceptance));
 if(list.execError){
   panel.append(el("p",list.execError),action("重新读取执行记录",()=>requestExecution(p,list,"status")));return;
 }
 if(executionRequests.has(list)||run.checking||run.status==="running"){
   panel.append(el("p","正在生成产物或运行测试，完成后会停在这里等你验收。"));
   if(!executionRequests.has(list)&&!executionTimers.has(list))pollExecution(p,list);
   return;
 }
 const result=run.result;
 if(result){
   panel.append(el("h3",run.status==="review"?"测试已通过 · 待你验收":"执行未通过"),
     el("p",result.error||("退出码 "+result.exitCode+" · 测试耗时 "+result.seconds+" 秒")),
     reference("查看交付文件与目录",(result.files||[]).join("\n")+"\n"+result.folder+"/files"),
     reference("运行日志与验收证据",result.log||result.error||"无输出"));
   for(const name of result.files||[]){
     const file=el("details","");const contents=el("pre","");
     file.append(el("summary","查看 "+name),contents);panel.append(file);
     file.ontoggle=async()=>{
       if(!file.open||contents.dataset.loaded)return;
       contents.textContent="正在读取…";
       try{
         const reply=await workbenchRequest("/api/execute",{method:"POST",headers:{"Content-Type":"application/json"},
           body:JSON.stringify({id:list.runId,action:"artifact",attempt:run.attempt,name})});
         const data=await reply.json();if(!reply.ok||typeof data.content!=="string")throw Error(data.error||"文件读取失败");
         contents.textContent=data.content;contents.dataset.loaded="yes";
       }catch(e){contents.textContent=e.message}
     };
   }
 }
 if(run.status==="review"){
   const approve=action("确认本项验收通过",()=>requestExecution(p,list,"approve"));
   approve.className="primary";panel.append(approve);
 }
 const start=action(result?"修改后重新执行":run.index?"开始下一项任务":"开始第一项任务",()=>{
   const feedback=result?prompt("请填写希望修正或补充的内容："):"";
   if(result&&!feedback?.trim())return;
   requestExecution(p,list,"start",feedback);
 });
 if(!result)start.className="primary";panel.append(start);
}
