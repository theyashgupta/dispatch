import { SOON_CONNECTIONS } from "../../../../shared/connection-meta.js";
import { SourceIcon } from "@/components/badges";
import { ConnectionCard } from "@/modules/connections/components/ConnectionCard";

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
