import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { MessageList } from "../../client/MessageList";
import type { ChatRecord, PendingMessage } from "../../client/roomState";

const ada = { authorName: "Ada", authorKey: "ada-key" };
const bob = { authorName: "Bob", authorKey: "bob-key" };

function message(id: number, author: typeof ada, time: string): ChatRecord {
  return { kind: "message", id, clientId: `client-${id}`, roomId: "room", body: `message ${id}`, createdAt: `2026-11-09T${time}.000Z`, ...author };
}

function joined(id: number, author: typeof ada): ChatRecord {
  return { kind: "join", id, roomId: "room", createdAt: "2026-11-09T10:00:00.000Z", ...author };
}

// Renders the list to HTML and describes each row: the name shown at the top of a group,
// whether the row shows the time, and whether it offers Retry. Events are their text.
function renderRows(messages: ChatRecord[], pending: PendingMessage[] = []) {
  const html = renderToStaticMarkup(
    <MessageList
      messages={messages}
      pending={pending}
      displayName="Ada"
      presenceKey="ada-key"
      historyEndId={Number.MAX_SAFE_INTEGER}
      note={null}
      top={null}
      toast={null}
      onRetry={() => {}}
      onTypeToComposer={() => {}}
    />,
  );
  const rows: (string | { name: string | null; time: boolean; retry: boolean })[] = [];
  for (const item of html.split("<li").slice(1)) {
    const eventText = item.match(/^ class="event">([^<]*)/)?.[1];
    if (eventText) {
      rows.push(eventText);
      continue;
    }
    rows.push({
      name: item.match(/class="(?:message-author|visually-hidden)">([^<]*)</)?.[1] ?? null,
      time: item.includes("<time"),
      retry: item.includes(">Retry</button>"),
    });
  }
  return rows;
}

describe("message groups", () => {
  test("messages from one author within 2 minutes form one group, with the name once and the time once", () => {
    const rows = renderRows([message(1, bob, "10:00:00"), message(2, bob, "10:01:00"), message(3, bob, "10:03:00")]);

    expect(rows).toEqual([
      { name: "Bob", time: false, retry: false },
      { name: null, time: false, retry: false },
      { name: null, time: true, retry: false },
    ]);
  });

  test("a pause of more than 2 minutes starts a new group", () => {
    const rows = renderRows([message(1, bob, "10:00:00"), message(2, bob, "10:02:01")]);

    expect(rows).toEqual([
      { name: "Bob", time: true, retry: false },
      { name: "Bob", time: true, retry: false },
    ]);
  });

  test("a new author starts a new group, and your own group is named You for screen readers", () => {
    const rows = renderRows([message(1, bob, "10:00:00"), message(2, ada, "10:00:10")]);

    expect(rows).toEqual([
      { name: "Bob", time: true, retry: false },
      { name: "You", time: true, retry: false },
    ]);
  });

  test("a join event ends a group, and the next message starts a new one", () => {
    const rows = renderRows([message(1, bob, "10:00:00"), joined(2, ada), message(3, bob, "10:00:20")]);

    expect(rows).toEqual([
      { name: "Bob", time: true, retry: false },
      "You joined the room",
      { name: "Bob", time: true, retry: false },
    ]);
  });
});

describe("failed messages", () => {
  test("a message the server rejected as invalid offers no Retry, and a network failure does", () => {
    const queuedAt = "2026-11-09T10:00:00.000Z";
    const rows = renderRows(
      [],
      [
        { clientId: "client-1", body: "rejected", status: "failed", failure: "invalid", queuedAt },
        { clientId: "client-2", body: "lost", status: "failed", failure: "network", queuedAt: "2026-11-09T10:05:00.000Z" },
      ],
    );

    expect(rows).toEqual([
      { name: "You", time: true, retry: false },
      { name: "You", time: true, retry: true },
    ]);
  });
});
