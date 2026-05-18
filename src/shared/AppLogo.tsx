import appIconUrl from '../assets/icon.png';

interface Props {
  className?: string;
}

/** LinguaLens brand mark (transparent PNG). */
export function AppLogo({ className = 'w-6 h-6 object-contain' }: Props) {
  return <img src={appIconUrl} alt="" className={className} draggable={false} />;
}
