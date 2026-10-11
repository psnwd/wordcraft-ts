<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { mountEditor, type WordCraftEditor } from "wordcraft-ts";

const FORMATS = ["docx", "odt", "rtf", "html", "md", "txt"];

const canvas = ref<HTMLCanvasElement>();
const fileInput = ref<HTMLInputElement>();
const status = ref("loading…");
const dirty = ref(false);
const format = ref("docx");
let editor: WordCraftEditor | undefined;
let unmounted = false;

onMounted(async () => {
  try {
    const e = await mountEditor(canvas.value!, { sample: true });
    if (unmounted) return e.destroy(); // left the page while loading
    editor = e;
    e.onDirty((d) => (dirty.value = d));
    status.value = "ready";
  } catch (err) {
    status.value = `failed: ${err}`;
  }
});

onBeforeUnmount(() => {
  unmounted = true;
  editor?.destroy();
});

function onOpen(ev: Event) {
  const input = ev.target as HTMLInputElement;
  const f = input.files?.[0];
  if (f) editor?.load(f);
  input.value = "";
}

async function exportDoc() {
  const blob = await editor!.exportBlob(format.value);
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `document.${format.value}` });
  a.click();
  URL.revokeObjectURL(a.href);
}
</script>

<template>
  <div class="app">
    <div class="bar">
      <span class="brand">WordCraft · Vue</span>
      <button @click="fileInput?.click()">Open…</button>
      <input ref="fileInput" type="file" hidden accept=".docx,.odt,.rtf,.md,.txt,.html" @change="onOpen" />
      <span class="spacer" />
      <span class="status"><i v-if="dirty" class="dot" />{{ status }}{{ dirty ? " · unsaved" : "" }}</span>
      <select v-model="format">
        <option v-for="f in FORMATS" :key="f" :value="f">.{{ f }}</option>
      </select>
      <button class="primary" :disabled="status !== 'ready'" @click="exportDoc">Export</button>
    </div>
    <div class="stage"><canvas ref="canvas" /></div>
  </div>
</template>
