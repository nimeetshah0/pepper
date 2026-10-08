// Shim for Plasmo's asset import schemes (also generated into .plasmo/index.d.ts
// by the first dev/build run; declaring them here keeps editors happy before that).
declare module "data-text:*" {
  const content: string;
  export default content;
}

declare module "*.svg" {
  const content: string;
  export default content;
}
