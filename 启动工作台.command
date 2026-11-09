#!/bin/zsh
cd -- "${0:A:h}"
if curl -fsS http://127.0.0.1:8876/workbench.js | grep -q 'function openProject'; then
  open http://127.0.0.1:8876
else
  exec /usr/bin/python3 prototype/server.py --open
fi
