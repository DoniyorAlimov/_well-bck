REM The backend now serves the built frontend from the same origin (see
REM ../routes/frontend.ts), which by default looks for it at
REM ../../_well-web/dist (i.e. _well-web checked out as a sibling of this
REM repo, same as in dev) — build it there first: cd ..\..\_well-web && npm
REM run build. Point FRONTEND_DIST_PATH at a different path if this server
REM doesn't keep that sibling layout.
cd "%cd%"
cd ..
npm start
