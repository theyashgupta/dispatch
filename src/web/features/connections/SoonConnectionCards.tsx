import { SOON_CONNECTIONS } from "../../lib/connection-meta.js";
import { ConnectionCard } from "../../primitives/ConnectionCard.js";
import { SourceIcon } from "../../components/badges/index.js";

export function SoonConnectionCards() {
  return (
    <>
      {SOON_CONNECTIONS.map((connection) => (
        <ConnectionCard
          key={connection.source}
          badge={<SourceIcon source={connection.source} />}
          name={connection.name}
          status={{ kind: "soon" }}
          credentialLabel="Arrives in a later release."
        />
      ))}
    </>
  );
}
