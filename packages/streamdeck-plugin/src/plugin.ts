import streamDeck from '@elgato/streamdeck';
import { DeckHost } from '@orca-agent-deck/deck-host';
import { ElgatoPort } from './elgato-port.ts';
import { AttentionAction, PaneAction, StatusAction } from './actions/keys.ts';

// Plugin B for the Stream Deck apps: deck-host does the work, ElgatoPort and the actions translate the SDK.
// Never log terminal content or the Orca runtime authToken.
streamDeck.logger.setLevel('info');

const port = new ElgatoPort();
const host = new DeckHost(port);
// Actions are registered before connecting; deck-host reads the settings only once connected.
streamDeck.actions.registerAction(new PaneAction(port, host));
streamDeck.actions.registerAction(new StatusAction(port, host));
streamDeck.actions.registerAction(new AttentionAction(port, host));
await streamDeck.connect();
process.once('SIGTERM', () => void host.bridge.stop());
// The SDK does not report a closed host socket: without this a plugin whose host quit stays as an orphan that
// still owns a bridge port, and A keeps talking to it.
void host.start({
  parent: process.ppid,
  onGone: (why) => {
    streamDeck.logger.info(`Stream Deck host gone (${why}), exiting`);
    void host.stop().finally(() => process.exit(0));
  },
});
