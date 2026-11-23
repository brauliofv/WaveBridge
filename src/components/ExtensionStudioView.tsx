import { useMemo, useState } from 'react';
import { Check, Copy, Download, FileCode2, Smartphone } from 'lucide-react';
import {
  buildChromeExtensionFiles,
  createExtensionZipBlob,
} from '../lib/extensionBuilder';
import { EXTENSION_RELEASE_DATE, EXTENSION_VERSION } from '../lib/appMeta';

export function ExtensionStudioView() {
  const origin =
    typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
  const files = useMemo(() => buildChromeExtensionFiles(origin), [origin]);
  const [selectedPath, setSelectedPath] = useState<string>(files[0].path);
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const selectedFile = files.find((f) => f.path === selectedPath) ?? files[0];

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(selectedFile.content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore
    }
  };

  const handleDownloadZip = async () => {
    setDownloading(true);
    try {
      const blob = await createExtensionZipBlob(origin);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'wavebridge-chrome-extension.zip';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6 pb-24 sm:px-6 lg:py-8 md:pb-8 space-y-8">
      {/* Header + Zip CTA */}
      <div className="flex flex-col gap-4 border-b border-white/10 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-[#F4F5F7] sm:text-3xl text-balance">
            Extensión de Chrome (Manifest V3) y App Android
          </h1>
          <p className="mt-1.5 text-sm text-[#9CA3AF] max-w-2xl">
            Código completo listo para cargar en Chrome usando <code className="font-mono text-[#F4F5F7]">chrome.desktopCapture</code> (todo el navegador), <code className="font-mono text-[#F4F5F7]">chrome.tabCapture</code> y documento offscreen, con modo <strong className="text-[#F4F5F7]">Directo al móvil (:8765)</strong> sin terminal y <strong className="text-[#F4F5F7]">Puente PC Plan B</strong> (<code className="font-mono text-[#F4F5F7]">http://localhost:3000</code>).{' '}
            <span className="font-mono text-xs text-[#6B7280] tabular-nums">
              v{EXTENSION_VERSION} · {EXTENSION_RELEASE_DATE}
            </span>
          </p>
        </div>

        <button
          type="button"
          onClick={handleDownloadZip}
          disabled={downloading}
          className="inline-flex min-h-[46px] items-center justify-center gap-2 rounded-xl bg-[#0EA5E9] px-5 py-2.5 text-sm font-semibold text-[#06121A] transition-colors hover:bg-[#38BDF8] whitespace-nowrap shrink-0"
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          {downloading ? 'Empaquetando .zip...' : 'Descargar extensión (.zip)'}
        </button>
      </div>

      {/* Code Inspector */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
        <aside className="lg:col-span-4 rounded-2xl border border-white/10 bg-[#13171D] p-4 space-y-2">
          <div className="px-2 py-1 text-xs font-semibold text-[#9CA3AF]">
            Archivos del paquete ({files.length})
          </div>
          <div className="space-y-1">
            {files.map((file) => {
              const active = file.path === selectedFile.path;
              return (
                <button
                  key={file.path}
                  type="button"
                  onClick={() => setSelectedPath(file.path)}
                  className={`flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${
                    active
                      ? 'bg-[#0EA5E9]/15 text-[#F4F5F7]'
                      : 'text-[#9CA3AF] hover:bg-white/5 hover:text-[#F4F5F7]'
                  }`}
                >
                  <FileCode2
                    className={`mt-0.5 h-4 w-4 shrink-0 ${active ? 'text-[#0EA5E9]' : 'text-[#6B7280]'}`}
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <div className="font-mono text-xs font-semibold text-[#F4F5F7]">
                      {file.path}
                    </div>
                    <div className="mt-0.5 text-xs text-[#9CA3AF] leading-snug">
                      {file.description}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        <section
          aria-label="Visor de código de la extensión"
          className="lg:col-span-8 rounded-2xl border border-white/10 bg-[#13171D] overflow-hidden"
        >
          <div className="flex items-center justify-between gap-4 border-b border-white/10 px-4 py-3">
            <span className="font-mono text-xs font-semibold text-[#F4F5F7]">
              {selectedFile.path}
            </span>
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border border-white/10 bg-[#0B0D10] px-3 py-1 text-xs font-medium text-[#F4F5F7] hover:border-white/25"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-[#10B981]" aria-hidden="true" />
              ) : (
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              {copied ? 'Copiado' : 'Copiar archivo'}
            </button>
          </div>
          <pre className="max-h-[460px] overflow-auto bg-[#0B0D10] p-4 font-mono text-xs leading-relaxed text-[#E5E7EB]">
            <code>{selectedFile.content}</code>
          </pre>
        </section>
      </div>

      {/* Step-by-Step Setup for Chrome & Android */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-[#13171D] p-6 space-y-4">
          <h2 className="font-display text-lg font-semibold text-[#F4F5F7]">
            01. Instalar la extensión en Chrome (Laptop)
          </h2>
          <ol className="space-y-2.5 text-sm text-[#9CA3AF] list-decimal list-inside leading-relaxed">
            <li>Descarga y descomprime el archivo <code className="font-mono text-[#F4F5F7]">wavebridge-chrome-extension.zip</code> en una carpeta local.</li>
            <li>Abre <code className="font-mono text-[#F4F5F7]">chrome://extensions</code> en tu navegador Chrome.</li>
            <li>Activa el interruptor <strong className="text-[#F4F5F7]">Modo de desarrollador</strong> en la esquina superior derecha.</li>
            <li>Haz clic en <strong className="text-[#F4F5F7]">Cargar descomprimida</strong>, selecciona la carpeta y fija WaveBridge en tu barra de herramientas.</li>
          </ol>
        </div>

        <div className="rounded-2xl border border-white/10 bg-[#13171D] p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Smartphone className="h-5 w-5 text-[#0EA5E9]" aria-hidden="true" />
            <h2 className="font-display text-lg font-semibold text-[#F4F5F7]">
              02. App Android (APK en GitHub) + Audífonos Bluetooth
            </h2>
          </div>
          <ol className="space-y-2.5 text-sm text-[#9CA3AF] list-decimal list-inside leading-relaxed">
            <li>Sube este repositorio a GitHub: el workflow <code className="font-mono text-[#F4F5F7]">build-apk.yml</code> compilará automáticamente <code className="font-mono text-[#F4F5F7]">wavebridge.apk</code> y lo publicará en <strong className="text-[#F4F5F7]">Releases</strong>.</li>
            <li>Instala <code className="font-mono text-[#F4F5F7]">wavebridge.apk</code> en tu Android, conecta tus audífonos Bluetooth y abre la app (<strong className="text-[#F4F5F7]">Plan A directo</strong> en puerto <code className="font-mono text-[#F4F5F7]">8765</code>).</li>
            <li>En Chrome pulsa <strong className="text-[#F4F5F7]">Buscar móvil</strong> y <strong className="text-[#F4F5F7]">Transmitir todo el navegador</strong>. Si tu router bloquea la conexión directa, usa <strong className="text-[#F4F5F7]">Plan B</strong> (<code className="font-mono text-[#F4F5F7]">python3 bridge.py</code>) o <strong className="text-[#F4F5F7]">Plan C</strong> (<code className="font-mono text-[#F4F5F7]">npm install && npm run build && npm run web</code>).</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
