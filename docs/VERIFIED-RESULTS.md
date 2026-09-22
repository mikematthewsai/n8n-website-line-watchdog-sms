# Verified results

Everything below was run on the exact workflow in [`workflow/`](../workflow/website-and-line-watchdog-sms.json). What was not run is listed at the end.

## Live, on n8n Cloud, 2026-09-22

A real website (matthewsautomation.net), a real Twilio number and the owner's own cell getting the texts. The schedule was set to every minute for the test. The number's configuration was only read, never changed. Execution ids are n8n's own.

| Run | Execution | Setup | Result |
| --- | --- | --- | --- |
| A | 388 | First check, with the real site plus a page that does not exist | Passed. One text saying what it watches and where things stand: site up, test page 404, the balance, where calls go, 0 texts blocked. Twilio's log shows it delivered |
| B | 389 | Second check | Passed. "watchdog-test-404 is down: the server answered 404, page not found. First failed check at 6:02 PM". Delivered |
| | 390 | Settings edited while published, not published again | The run used the old settings. See the finding below |
| C | 391, 392 | Required text changed to one that is not on the page, balance floor raised above the balance, then published | Passed. The balance alert went out at once. The site was reported down on the next check: "the page loads but ... is missing from it". Both delivered |
| D | 393 | Required text and floor put back | Passed. One text, two lines: "back up after 2 min" and "balance is back up". Delivered |
| E | 394 | Owner cell changed to a number Twilio refuses | Passed. Twilio answered 21211 (invalid To number). The "Went out?" check took the false branch and the text was kept |
| F | 395 | Owner cell put back | Passed. The kept text went out on the next check together with the new one. Delivered |
| G | 396, 397 | Quiet hours set around the current time, test page added back | Passed. Nothing was sent. After the second failed check the down alert was held for the morning check-in |

After testing, the settings went back to the example numbers and defaults, the schedule to 5 minutes, and the workflow was switched off.

**Finding that changed the workflow.** On n8n 2.x an edit to a published workflow does not reach the running copy until it is published again, so run 390 still used the old settings. The testing note on the canvas and the README now say so.

**Fix made during the runs.** Run C printed the floor as $1000.00. The amount formatting now adds the comma. Runs A to C ran before that fix; D to G ran the final code.

## Local n8n 2.40.5 against a mock Twilio API and a mock website

The same workflow file, with the Twilio base URL pointed at a local mock so the responses could be controlled, and the schedule swapped for a webhook so each run could be started on demand. Every run was a production execution of a published workflow, so the stored memory was really kept between runs. 29 runs.

| Setup | Result |
| --- | --- |
| First run, all good | Startup text with what it watches |
| Site answers 503 twice | Nothing on the first, down alert on the second |
| Site answers 200 but the required text is missing | Stays down, no repeat text, since it is the same outage |
| Site restored | "back up after 1 min" |
| Balance under the floor, again, then topped up | One alert, no repeat, then "back up" |
| Calls moved to a Studio flow | Old and new destination, SIDs shortened, query strings dropped |
| Number missing from the account | Urgent alert |
| Twilio's number lookup returns 500 | Check skipped for that round, "routing unknown", no false alarm |
| Number back | "back on your Twilio account" and the route change, in one text |
| Three carrier blocks in the hour, plus a block to the owner and one 90 minutes old | "3 of the 5 texts", the owner's and the old one left out, not repeated inside the window |
| Alert refused by Twilio | Kept, sent on the next check |
| Two sites, one never answers | The real 15 second timeout, reported as "no answer within 15 seconds". Each site alerted on its own |
| No websites at all | Straight to the Twilio checks |
| Example numbers left in | The run stops and says why |
| Quiet hours around the current time | Startup still sent, down alert held, routing change sent anyway |
| Settings edited while published | Stored memory kept through the edit |

Two details were confirmed here rather than assumed: the HTTP Request node puts the page in `data`, not `body`, when it returns the full response as text, and a timeout comes back as an item with `error.message` "timeout of 15000ms exceeded".

## Automated checks

[`tests/watchdog.test.js`](../tests/watchdog.test.js): 63 checks against the Code node source in the workflow file, with the clock frozen. CI runs them on every push.

## Code parity

The tested copy in n8n and the published file were compared with SHA-256 over the Code nodes, computed in the n8n page: both `b0e843c2 648a4157 2668e681 5e75926e 32c7a119 68718f17 af093cdb 150369ee`. The published file is `a8f089ec 7dbc306c 63133f5f 683b788f c69e7b60 1103726b 70df4b6c f1ee678d`.

## Not covered

- The morning check-in firing live. It needs a new day, and n8n does not let a workflow's stored memory be set from outside.
- A real routing change, a number leaving the account and real carrier blocking. Only simulated, on purpose: they were not going to be done to a live business number.
- An expired certificate and a DNS failure against a real site. Covered by the automated checks only.
