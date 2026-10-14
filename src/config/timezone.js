// Must be the first import in app.js. All server date math (setHours,
// new Date(y, m, d), date-fns) then runs in UTC, so local dev (IST) and
// EC2 (UTC) behave the same way.
process.env.TZ = "UTC";
