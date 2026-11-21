CREATE TABLE "share" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"request_key" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"status" text NOT NULL,
	"public_token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"revoked_at" timestamp,
	CONSTRAINT "share_user_id_id_unique" UNIQUE("user_id","id"),
	CONSTRAINT "share_user_request_key_unique" UNIQUE("user_id","request_key"),
	CONSTRAINT "share_public_token_unique" UNIQUE("public_token"),
	CONSTRAINT "share_status_check" CHECK ("share"."status" in ('active', 'revoked'))
);
--> statement-breakpoint
CREATE TABLE "share_chunk" (
	"share_id" text NOT NULL,
	"user_id" text NOT NULL,
	"google_account_email" text NOT NULL,
	"file_id" text NOT NULL,
	"chunk_index" integer NOT NULL,
	"media_key" text NOT NULL,
	"sha1" text NOT NULL,
	"payload_size" integer NOT NULL,
	"is_last" boolean NOT NULL,
	CONSTRAINT "share_chunk_pk" PRIMARY KEY("share_id","user_id","google_account_email","file_id","chunk_index")
);
--> statement-breakpoint
CREATE TABLE "share_file" (
	"id" text NOT NULL,
	"share_id" text NOT NULL,
	"user_id" text NOT NULL,
	"google_account_email" text NOT NULL,
	"file_id" text NOT NULL,
	"file_hash" text NOT NULL,
	"name" text NOT NULL,
	"folder" text NOT NULL,
	"relative_folder" text NOT NULL,
	"chunk_count" integer NOT NULL,
	"size" bigint NOT NULL,
	CONSTRAINT "share_file_pk" PRIMARY KEY("share_id","user_id","google_account_email","file_id"),
	CONSTRAINT "share_file_id_unique" UNIQUE("id")
);
--> statement-breakpoint
ALTER TABLE "share" ADD CONSTRAINT "share_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_chunk" ADD CONSTRAINT "share_chunk_file_fk" FOREIGN KEY ("share_id","user_id","google_account_email","file_id") REFERENCES "public"."share_file"("share_id","user_id","google_account_email","file_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_file" ADD CONSTRAINT "share_file_share_fk" FOREIGN KEY ("share_id","user_id") REFERENCES "public"."share"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "share_user_created_idx" ON "share" USING btree ("user_id","created_at");