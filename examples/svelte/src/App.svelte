<script lang="ts">
  import { onMount } from "svelte";
  import { mountEditor, type WordCraftEditor } from "wordcraft-ts";

  const FORMATS = ["docx", "odt", "rtf", "html", "md", "txt"];

  let canvas: HTMLCanvasElement;
  let fileInput: HTMLInputElement;
  let editor: WordCraftEditor | undefined;
  let status = $state("loading…");
  let dirty = $state(false);
  let format = $state("docx");

  onMount(() => {
    let cancelled = false;
    mountEditor(canvas, { sample: true })
      .then((e) => {
        if (cancelled) return e.destroy(); // left the page while loading
        editor = e;
        e.onDirty((d) => (dirty = d));
        status = "ready";
      })
      .catch((err) => (status = `failed: ${err}`));
    return () => {
      cancelled = true;
      editor?.destroy();
    };
  });

  function onOpen(ev: Event) {
    const input = ev.currentTarget as HTMLInputElement;
    const f = input.files?.[0];
    if (f) editor?.load(f);
    input.value = "";
  }

  async function exportDoc() {
    const blob = await editor!.exportBlob(format);
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `document.${format}` });
    a.click();
    URL.revokeObjectURL(a.href);
  }
</script>

<div class="app">
  <div class="bar">
    <span class="brand">WordCraft · Svelte</span>
    <button onclick={() => fileInput.click()}>Open…</button>
    <input bind:this={fileInput} type="file" hidden accept=".docx,.odt,.rtf,.md,.txt,.html" onchange={onOpen} />
    <span class="spacer"></span>
    <span class="status">{#if dirty}<i class="dot"></i>{/if}{status}{dirty ? " · unsaved" : ""}</span>
    <select bind:value={format}>
      {#each FORMATS as f}<option value={f}>.{f}</option>{/each}
    </select>
    <button class="primary" disabled={status !== "ready"} onclick={exportDoc}>Export</button>
  </div>
  <div class="stage"><canvas bind:this={canvas}></canvas></div>
</div>
