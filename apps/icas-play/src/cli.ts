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
    console.log("icas-play run scaffold: run <id> --url <u> ...typed inputs... [--tenant default icas-bank] [--assist]");
    break;
  default:
    console.log("Usage: icas-play <list|describe|run>");
}
