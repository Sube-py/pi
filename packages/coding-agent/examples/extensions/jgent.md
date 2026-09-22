# jgent

Routes tool selection through Jev so the model only carries `bash` and `need`
until it asks for more.

## Enable

Set `TYPESAFE_API_KEY`, then load the extension:

    pi -e packages/coding-agent/examples/extensions/jgent.ts

## What changes

The model sees two tools: `bash` and `need`. When it calls `need` with a
description of what it is trying to do, jgent asks Jev which of the configured
tools that requires and enables the selected ones for the next turn. They are
removed again at the end of that turn. Tools run exactly as they do without
jgent.

Skills are not visible to an extension, so the default entry routes tools only.
Pass the skill catalog to `defaultJgentExtension(skills)` to include skills.
