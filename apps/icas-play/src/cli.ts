#!/usr/bin/env node

const [, , command = "help"] = process.argv;

switch (command) {
  case "list":
    console.log("icas-play list scaffold: load capabilities/*.json and print catalog");
    break;
  case "describe":
    console.log("icas-play describe scaffold");
    break;
  case "run":
    console.log("icas-play run scaffold: strict deterministic replay by default; --assist optional");
    break;
  default:
    console.log("Usage: icas-play <list|describe|run>");
}
