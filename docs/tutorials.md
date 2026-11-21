# Tutorials

[Back to the README](../README.md) · [Getting started](getting-started.md) · [Modules](modules.md) · [Optimiser and risk](optimiser-and-risk.md) · [Results and exports](results-and-exports.md) · [Limits and questions](limits-and-faq.md)

Earthmove has step-by-step tutorials built in. Each one dims the page, spotlights one control or panel, and shows a small card beside it with a sentence or two. Most steps ask you to try something, such as changing the speed or pressing Optimise, and move on by themselves when you have done it. **Next** is always there, so you can never get stuck.

## Opening a tutorial

The first time you open the tool, it offers the Quick start. Choose **No thanks** and it will not offer it again. You can start any tutorial at any time from the **Tutorials** button in the top bar. A tick shows the ones you have finished, and you can run any of them again as often as you like. **Reset tutorial progress** at the bottom of the menu clears the ticks and brings the Quick start offer back.

On the card, **Back**, **Next** and **Exit** do what they say. The left and right arrow keys step back and forward, and Escape exits. The card shows how far through you are, for example "Step 3 of 13".

## Your own work is safe

A tutorial runs on its own built-in example, not on your scenario. While it runs, nothing is written to your saved scenario, and when you finish or exit, your scenario, your saved comparisons and your view (the tab, zoom, position in time and speed) are put back exactly as they were.

You can leave at any step. If you close the page part-way, your scenario is unchanged, and the Tutorials menu offers **Carry on** from the step where you stopped.

Tutorials are not available in replay mode.

## The tutorials

| Tutorial | About | What you do |
|---|---|---|
| **Quick start** | 5 minutes | What the road view shows, editing a section, the global settings, playing and changing speed, the daily movements counter, and the results table of dates |
| **Asking a what-if question** | 4 minutes | Save your plan, change the daily movement limit, see the completion date move, and compare the two |
| **Optimising** | 4 minutes | Run the optimiser, read the before and after table, and learn what "Simple dispatch, not optimised" means |
| **Going further** | 4 minutes | The setup screen, the levels, switching a module on and off, and "vary by section" |

There is also a short tutorial (three to five steps) for each of the 29 [optional modules](modules.md), listed under **Optional modules** in the Tutorials menu. The first time you switch one module on, Earthmove offers to show you how it works. The tutorials for the **Mass haul diagram** (E3) and the **Time-chainage chart** (E8) are good ones to start with.

## Changing the tutorials

The tutorials are plain data in `src/tutorials.js`: for each step, what to spotlight, the words, and what counts as having done it. The file begins with a short guide to the format. The code that runs them is in `src/tutorial.js`.
