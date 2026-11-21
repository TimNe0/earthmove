# Limits and common questions

[Back to the README](../README.md) · [Getting started](getting-started.md) · [Modules](modules.md) · [Optimiser and risk](optimiser-and-risk.md) · [Results and exports](results-and-exports.md)

## What the model is, and is not

Earthmove is a planning model for comparing options: this haul plan against that one, with or without a constraint, with more lorries or fewer. Its answers are estimates. It is not a contractor's programme, a method statement or a price, and its results should be checked by someone who knows the site.

## Simplifications to know about

- **One haul road along the scheme.** Distances are measured along the road between the middle of each section. There are no side routes or ramps, and gradients are only allowed for as a speed factor per section (module B3).
- **Simple dispatch is greedy.** Each load goes to the nearest fill that can take it. Because of this, adding a constraint can occasionally make the simple-dispatch result finish slightly earlier, as the constraint happens to send soil somewhere better. Do not assume more constraints always mean a later finish. The optimiser does not have this problem in that direction: removing a constraint never makes its finish later.
- **Stockpile planning in the optimiser is unproven.** The optimiser can plan routes through a stockpile, but on the examples tested so far it has never needed to, because simple dispatch already uses stockpiles when a fill is not open.
- **Single-lane stretches (C2)** delay loaded trips only.
- **Blockages with a fixed fleet (C1 with B1).** Empty return trips are delayed on the cautious side.
- **Breakdowns are counted per loading point (D2),** not per excavator. Availability (B6) also applies, so using both counts lost time twice.
- **Shifts (D4) cannot run past midnight.** Use two shifts instead.
- **Bank holidays are England and Wales** to start with. You can edit the list and add one-off days.
- **Results are in tonnes with A1 or A3 on,** because each soil type then has its own density.
- **Rates start as placeholders.** Cost, fuel, carbon, weather and breakdown figures are general guesses until you enter your own. Every result that uses one is marked.

## Common questions

**Is my data uploaded anywhere?**
No. The tool runs entirely in your web browser. Your scenario is kept in your browser's own storage, and files only go where you save them.

**Does it work offline?**
Yes. Build your own copy with `python3 build.py` (see the [README](../README.md)) and open `dist/earthmove.html` from disk. It needs no internet connection.

**Why does a section never reach level?**
Look at the Messages tab first. The usual reasons are: the cut and fill do not balance, a fill opens after all the nearby soil has gone elsewhere, a section is closed (C3) or cut off by a blockage (C1), or a soil type rule (A2) means nothing on site is allowed to fill it.

**Why did choosing the Standard level make the job finish later?**
Standard switches on the calendar module (D4), which makes bank holidays non-working days. It also switches on the fleet limit (B1) and receiving rates (B4), which can slow the job down if their starting values do not suit your site. Check the Fleet & plant and Site & calendar tabs.

**How many lorries do I need?**
With B1 and B2 off, lorries are unlimited and the Results tab tells you how many the plan uses: the daily peak, and the number that covers 95% of working days. Set that number in B1 to see how a fixed fleet changes the finish.

**Why is the optimised result different on another computer?**
The search runs for a set time, so a faster computer tries more plans. The results are close but not always identical.

**Which browsers does it work in?**
Any up-to-date Chrome, Edge, Firefox or Safari.

**How do I report a problem or suggest an improvement?**
[Contact Intelligent Planning](https://www.intelligent-planning.com/contact.php), or open an issue on this repository.
