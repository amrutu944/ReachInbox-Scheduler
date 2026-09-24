import { Client } from "@elastic/elasticsearch";
import { env } from "../config/env";

export const esClient = new Client({
  node: env.esNode,
  maxRetries: 0,
  requestTimeout: 1000,
});

export async function ensureIndex() {
  const exists = await esClient.indices.exists({ index: env.esIndex });
  if (!exists) {
    await esClient.indices.create({
      index: env.esIndex,
      mappings: {
        properties: {
          recipient: { type: "text" },
          subject: { type: "text" },
          body: { type: "text" },
          status: { type: "keyword" },
          senderName: { type: "keyword" },
          userId: { type: "keyword" },
          scheduledTime: { type: "date" },
          sentTime: { type: "date" },
        },
      },
    });
  }
}

export interface IndexableEmail {
  id: string;
  userId: string;
  recipient: string;
  subject: string;
  body: string;
  status: string;
  senderName: string;
  scheduledTime: string;
  sentTime?: string | null;
}

/** Upserts an email into Elasticsearch so scheduled + sent emails are searchable. Never throws. */
export async function indexEmail(email: IndexableEmail) {
  try {
    await esClient.index({
      index: env.esIndex,
      id: email.id,
      document: email,
    });
  } catch (err) {
    console.error("Elasticsearch indexing failed (non-fatal):", err);
  }
}

export async function searchEmails(userId: string, query: string) {
  const result = await esClient.search({
    index: env.esIndex,
    query: {
      bool: {
        filter: [{ term: { userId } }],
        must: query
          ? [
              {
                multi_match: {
                  query,
                  fields: ["recipient", "subject", "body"],
                },
              },
            ]
          : [],
      },
    },
  });
  return result.hits.hits.map((h) => h._source);
}
