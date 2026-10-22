import assert from "node:assert/strict"
import { test } from "node:test"

import { bashGuard } from "../src/core/profiles.ts"
import {
  childMessageKind,
  isQuestion,
  reportMessage,
} from "../src/extensions/sessions.ts"

const guard = (command: string, branch = "feature", denyCommands?: string[]) =>
  bashGuard(command, {
    cwd: "/repo",
    ...(denyCommands ? { denyCommands } : {}),
    currentBranch: () => Promise.resolve(branch),
  })

void test("the bash guard refuses sudo, pushes to main, and denied commands", async () => {
  assert.match((await guard("sudo apt install x")) ?? "", /sudo/)
  assert.match((await guard("ls && sudo rm x")) ?? "", /sudo/)
  assert.match((await guard("FOO=1 sudo ls")) ?? "", /sudo/)
  assert.match((await guard("bash -c 'sudo ls'")) ?? "", /sudo/)
  assert.equal(await guard("grep sudo notes.txt"), undefined)
  assert.equal(await guard("echo 'sudo'"), undefined)

  assert.match((await guard("git push origin main")) ?? "", /main/)
  assert.match((await guard("git push origin HEAD:main")) ?? "", /main/)
  assert.match(
    (await guard("git push -f origin feature:refs/heads/master")) ?? "",
    /main or master/
  )
  assert.match((await guard("git -C sub push --all")) ?? "", /--all/)
  assert.match((await guard("git push", "main")) ?? "", /branch main/)
  assert.match(
    (await guard("git push -u origin HEAD", "master")) ?? "",
    /master/
  )
  assert.equal(await guard("git push"), undefined)
  assert.equal(await guard("git push origin feature"), undefined)
  assert.equal(await guard("git log main"), undefined)

  const deny = ["npm publish", "git reset --hard"]
  assert.match(
    (await guard("npm publish --tag next", "x", deny)) ?? "",
    /npm publish/
  )
  assert.match(
    (await guard("cd a; git reset --hard HEAD~1", "x", deny)) ?? "",
    /git reset --hard/
  )
  assert.equal(await guard("npm test", "x", deny), undefined)
  assert.equal(await guard("git reset --soft HEAD~1", "x", deny), undefined)
})

void test("child messages are marked as questions or finished work", () => {
  assert.ok(isQuestion("Question: use A or B?\nI recommend A.", false))
  assert.ok(isQuestion("**Question:** which one", false))
  assert.ok(isQuestion("Done the part.\nShould I also update the docs?", false))
  assert.ok(isQuestion("All done.", true))
  assert.ok(!isQuestion("All done. The tests pass.", false))
  assert.equal(
    childMessageKind("Question: A or B?", false, "a job"),
    "question"
  )
  assert.equal(
    childMessageKind("Started the build.", false, "a job"),
    "waiting"
  )
  assert.equal(childMessageKind("All done.", false, undefined), "done")
  const question = reportMessage({
    name: "s5",
    title: "Helper",
    answer: "Question: may I push?",
    needsInput: false,
    child: true,
  })
  assert.match(question, /^\[Child session s5: question\] Helper/)
  assert.match(question, /send_to_session/)
  const done = reportMessage({
    name: "s5",
    title: "Helper",
    answer: "Changed two files.",
    needsInput: false,
    child: true,
  })
  assert.match(done, /^\[Child session s5: done\] Helper/)
})
