import { GameProvider, useGame } from './state/engine';
import { PrefsProvider } from './state/prefs';
import { Boot } from './components/Boot';
import { Doors } from './components/Doors';
import { Play } from './components/Play';

function Shell() {
  const { phase } = useGame();
  if (phase === 'boot') return <Boot />;
  if (phase === 'door') return <Doors />;
  return <Play />;
}

export default function App() {
  return (
    <GameProvider>
      <PrefsProvider>
        <Shell />
      </PrefsProvider>
    </GameProvider>
  );
}
