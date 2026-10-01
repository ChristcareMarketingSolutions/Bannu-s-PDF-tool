/**
 * Tool registry — the single place that lists every tool.
 *
 * To add a new tool:
 *   1. Create js/tools/my-tool.js exporting `default function mount(ctx)`
 *      (use createPageTool or createQueueTool from js/core for most tools).
 *   2. Add an entry below. The home grid, search, deep links (#my-tool) and
 *      the workspace modal pick it up automatically.
 */
export const CATEGORIES = [
  { id: 'all', label: 'All tools' },
  { id: 'organize', label: 'Organize' },
  { id: 'convert', label: 'Convert' },
  { id: 'optimize', label: 'Edit & optimize' },
  { id: 'security', label: 'Security' },
];

export const TOOLS = [
  {
    id: 'merge', category: 'organize', name: 'Merge PDF', icon: 'merge', accepts: 'pdfs',
    description: 'Combine multiple PDF files into one document.',
    longDescription: 'Combine multiple PDFs into one document. Add your files, drag them into the right order, then merge.',
    keywords: 'combine join append bind together multiple',
    libs: ['pdfjs', 'pdflib'],
    load: () => import('./merge.js'),
  },
  {
    id: 'split', category: 'organize', name: 'Split PDF', icon: 'split', accepts: 'pdf',
    description: 'Split a PDF into separate files by page range.',
    longDescription: 'Split a PDF by custom page ranges, every N pages, or into single pages. Multiple results are packaged as a ZIP.',
    keywords: 'separate divide break ranges cut',
    libs: ['pdfjs', 'pdflib', 'jszip'],
    load: () => import('./split.js'),
  },
  {
    id: 'extract', category: 'organize', name: 'Extract Pages', icon: 'extract', accepts: 'pdf',
    description: 'Extract selected pages from a PDF.',
    longDescription: 'Pick the pages you need — click thumbnails or type ranges — and save them as a new PDF.',
    keywords: 'select pick pull copy pages subset',
    libs: ['pdfjs', 'pdflib'],
    load: () => import('./extract.js'),
  },
  {
    id: 'delete', category: 'organize', name: 'Delete Pages', icon: 'trash', accepts: 'pdf',
    description: 'Remove unwanted pages from a PDF.',
    longDescription: 'Click the pages you want to remove (or type page numbers), then export a clean copy.',
    keywords: 'remove erase drop pages blank',
    libs: ['pdfjs', 'pdflib'],
    load: () => import('./delete.js'),
  },
  {
    id: 'reorder', category: 'organize', name: 'Reorder Pages', icon: 'reorder', accepts: 'pdf',
    description: 'Drag and reorder PDF pages before exporting.',
    longDescription: 'Drag pages into a new order (or use the keyboard), reverse the document, then export.',
    keywords: 'organize organise sort arrange move order rearrange',
    libs: ['pdfjs', 'pdflib'],
    load: () => import('./reorder.js'),
  },
  {
    id: 'rotate', category: 'organize', name: 'Rotate PDF', icon: 'rotate', accepts: 'pdf',
    description: 'Rotate individual pages or the entire document.',
    longDescription: 'Rotate single pages, selected pages or the whole document by 90° or 180°.',
    keywords: 'turn orientation landscape portrait flip',
    libs: ['pdfjs', 'pdflib'],
    load: () => import('./rotate.js'),
  },
  {
    id: 'pdf-to-images', category: 'convert', name: 'PDF to Images', icon: 'image', accepts: 'pdf',
    description: 'Convert PDF pages into PNG or JPG images.',
    longDescription: 'Convert all or selected pages into high-quality PNG or JPG images.',
    keywords: 'convert png jpg jpeg picture export image',
    libs: ['pdfjs', 'jszip'],
    load: () => import('./pdf-to-images.js'),
  },
  {
    id: 'images-to-pdf', category: 'convert', name: 'Images to PDF', icon: 'images', accepts: 'images',
    description: 'Combine images into a single PDF document.',
    longDescription: 'Turn JPG, PNG, WebP, GIF or BMP images into one PDF. Reorder them and choose a page size.',
    keywords: 'jpg png photo picture convert scan create',
    libs: ['pdflib', 'pdfjs'],
    load: () => import('./images-to-pdf.js'),
  },
  {
    id: 'compress', category: 'optimize', name: 'Compress PDF', icon: 'compress', accepts: 'pdf',
    description: 'Reduce PDF file size while maintaining reasonable quality.',
    longDescription: 'Make your PDF smaller. Choose a lossless clean-up, image optimisation, or maximum compression.',
    keywords: 'reduce shrink smaller optimize optimise size',
    libs: ['pdflib', 'pdfjs'],
    load: () => import('./compress.js'),
  },
  {
    id: 'watermark', category: 'optimize', name: 'Watermark PDF', icon: 'watermark', accepts: 'pdf',
    description: 'Add a text watermark to your PDF pages.',
    longDescription: 'Stamp text such as CONFIDENTIAL or DRAFT across your pages. Control size, colour, opacity and angle.',
    keywords: 'stamp text confidential draft mark overlay',
    libs: ['pdfjs', 'pdflib'],
    load: () => import('./watermark.js'),
  },
  {
    id: 'page-numbers', category: 'optimize', name: 'Page Numbers', icon: 'hash', accepts: 'pdf',
    description: 'Add page numbers to your PDF.',
    longDescription: 'Add page numbers in the position and style you like — e.g. "Page 3 of 10".',
    keywords: 'numbering paginate footer header bates',
    libs: ['pdfjs', 'pdflib'],
    load: () => import('./page-numbers.js'),
  },
  {
    id: 'protect', category: 'security', name: 'Protect PDF', icon: 'lock', accepts: 'pdf',
    description: 'Add password protection to a PDF.',
    longDescription: 'Encrypt your PDF with a password using AES-256 and choose what readers may do with it.',
    keywords: 'password encrypt secure lock aes security',
    libs: ['pdfjs', 'pdflib'],
    load: () => import('./protect.js'),
  },
  {
    id: 'unlock', category: 'security', name: 'Unlock PDF', icon: 'unlock', accepts: 'pdf',
    description: 'Remove the password from a PDF you can open.',
    longDescription: 'Enter the password of your PDF once and save an unlocked copy without restrictions.',
    keywords: 'decrypt remove password unprotect open restrictions',
    libs: ['pdfjs', 'pdflib'],
    load: () => import('./unlock.js'),
  },
];

export const getTool = (id) => TOOLS.find((t) => t.id === id);
