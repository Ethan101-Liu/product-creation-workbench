// The private desktop service commits each edit before the window can close.
window.desktopWorkspace = (() => {
  let revision;
  function request(method, body) {
    const xhr = new XMLHttpRequest();
    xhr.open(method, "/api/workspace", false);
    if (method === "POST") {
      xhr.setRequestHeader("Content-Type", "application/json");
      xhr.setRequestHeader("X-Workspace-Revision", revision);
    }
    xhr.send(body);
    const data = JSON.parse(xhr.responseText);
    if (xhr.status !== 200) throw new Error(data.error || "无法访问本机项目文件。");
    revision = data.revision;
    return data.value;
  }
  return {load: () => request("GET"), save: value => request("POST", value)};
})();
