# Design decisions

**No database.** Everything it needs to remember (which sites are down and since when, the last known routing, what is waiting for the morning) fits in n8n's workflow static data. The price is that the memory only exists while the workflow is published, which the README says plainly.

**Two failed checks before an alert.** A single slow response or a deploy in progress should not wake anyone. At a 5 minute interval a real outage is reported within about 10 minutes.

**One text per change, not per check.** Down once, a reminder every 4 hours, back up once. Anything more and the owner stops reading them.

**A morning check-in on quiet days too.** A monitor that is silent when things are fine is indistinguishable from one that has stopped running. One short text a day is the cheapest proof that it is alive. It can be switched off.

**Quiet hours hold everything except routing.** A site that is down at 2 AM can wait for the morning. Calls being sent somewhere else, or the number leaving the account, cannot, because after-hours calls are often the most valuable ones for a service business.

**Read only.** Every Twilio call apart from the text to the owner is a read. It reports a routing change; it never tries to put it back.

**Warn at a floor, not at zero.** The alerts go out through the same Twilio account. At $0 there is nothing left to warn with.

**Only carrier refusals count as blocking.** 30004, 30007, 30032 and 30034 say something about the line. A landline or a mistyped number says something about one customer, so those are left out, and so are the watchdog's own texts to the owner.

**A failed alert is kept.** If Twilio will not take the text, it goes again on the next check, for up to 24 hours, together with anything new.

**Settings are checked before anything runs.** The example numbers, a bad phone number or an unknown time zone stop the run with a plain reason instead of texting nobody.

**Numbers read from settings keep 0.** Zero switches a check off, so a blank setting falls back to the default but a 0 is kept. An earlier workflow in this series lost a configured 0 to `value || default`.
