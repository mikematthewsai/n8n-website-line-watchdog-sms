# The texts it sends

The first two are real, from the live test on 2026-09-22 against matthewsautomation.net. The rest use example values.

Down, after the second failed check:

> Watchdog: matthewsautomation.net/watchdog-test-404 is down: the server answered 404, page not found. First failed check at 6:02 PM. I will text you when it is back.

A page that loads without the text it must contain (the test asked for text that was not on the page):

> Watchdog: matthewsautomation.net is down: the page loads but "zzq-not-on-this-page" is missing from it. First failed check at 6:05 PM. I will text you when it is back.

First check after publishing:

> Watchdog: now on for Your Business. Watching example.com, +15555550100, your Twilio balance and carrier blocking. Right now: website up, Twilio balance $84.20, calls go to hooks.example.com/voice, 0 of 12 texts blocked in the last 60 min. You get a short check-in each morning at 7:00 AM. Otherwise you only hear from me when something breaks or recovers.

Back up, together with another change:

> Watchdog:
> - example.com is back up after 37 min.
> - Your Twilio balance is back up to $60.00.

Still down:

> Watchdog: example.com is still down, 4 h 5 min so far: the server answered 503, a server error.

Balance:

> Watchdog: Your Twilio balance is $14.80, under your $20.00 floor. At $0 your texts and calls stop, and so do these alerts.

Routing change:

> Watchdog: Calls to +15555550100 used to go to hooks.example.com/voice. They now go to other.example.net/answer. If you did not change this, check Twilio now.

Number gone:

> Watchdog: +15555550100 is not on your Twilio account any more. Calls and texts to it are not reaching you. Check the Twilio console now.

Carrier blocking:

> Watchdog: 3 of the 5 texts your number sent in the last 60 min were blocked by carriers: 30007 carrier filtering (2), 30034 number not registered for A2P 10DLC (1). Those customers did not get them.

Morning check-in after a night with an outage:

> Watchdog: Morning check-in. Overnight: 10:05 PM example.com is down: the server answered 502, a server error. First failed check at 10:00 PM. I will text you when it is back. 2:15 AM example.com is back up after 4 h 15 min.
> Right now: website up, Twilio balance $84.20, calls go to hooks.example.com/voice, 0 of 0 texts blocked in the last 60 min.
