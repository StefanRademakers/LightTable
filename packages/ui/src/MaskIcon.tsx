/** Monochrome artwork tinted by its control; the host continues to own the asset. */
export function MaskIcon({ src, mode = 'alpha' }: { src: string; mode?: 'alpha' | 'luminance' }) {
  return <span className="ui-mask-icon" aria-hidden="true" style={{ maskImage: `url(${JSON.stringify(src)})`, maskMode: mode }} />;
}
