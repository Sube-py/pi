# jgent

Routes tool selection through Jev so the model keeps pi's built-in tools, and only tools and skills added
on top of them are loaded when it asks.

## Enable

Load the extension:

    pi -e packages/coding-agent/examples/extensions/jgent.ts

With no `TYPESAFE_API_KEY` set, decisions run locally through
[Laya](https://github.com/receptron/laya), an open-source Jev-compatible model.
The first call downloads about 1.7 GB of weights into `~/.cache/receptron-laya`.
Set `TYPESAFE_API_KEY` to use the TypeSafe Jev API instead.

## What changes

The model keeps pi's built-in tools (`read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`) plus `need`. When it calls `need` with a
description of what it is trying to do, jgent asks Jev which of the configured
tools that requires and enables the selected ones for the next turn. They are
removed again at the end of that turn. Tools run exactly as they do without
jgent.

Skills are not visible to an extension, so the default entry routes tools only.
Pass the skill catalog to `defaultJgentExtension(skills)` to include skills.
