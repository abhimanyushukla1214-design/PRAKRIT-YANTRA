@echo off
REM LoopStream — auto-start helper
REM Double-click to start the loop stream manually.
REM For fully automatic restart after PC reboot: register this .bat in Task Scheduler
REM (Trigger: At startup / logon → Action: start this program).

cd /d "C:\Users\ANKUR MINERALS\OneDrive\Documents\Default Project\loopstream"
node server.js
