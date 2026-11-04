ALTER TABLE "google_account" DROP CONSTRAINT "google_account_pkey";--> statement-breakpoint
ALTER TABLE "google_account" ADD COLUMN "id" text;--> statement-breakpoint
UPDATE "google_account" SET "id" = gen_random_uuid() WHERE "id" IS NULL;--> statement-breakpoint
ALTER TABLE "google_account" ALTER COLUMN "id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "google_account" ADD CONSTRAINT "google_account_pkey" PRIMARY KEY ("id");--> statement-breakpoint
ALTER TABLE "google_account" ADD CONSTRAINT "google_account_user_id_id_unique" UNIQUE("user_id","id");--> statement-breakpoint
ALTER TABLE "google_account" ADD CONSTRAINT "google_account_user_id_email_unique" UNIQUE("user_id","email");--> statement-breakpoint
CREATE TABLE "chunk_metadata" (
	"user_id" text NOT NULL,
	"google_account_id" text NOT NULL,
	"media_key" text NOT NULL,
	"sha1" text NOT NULL,
	"stored_bmp_size" integer NOT NULL,
	"file_hash" text NOT NULL,
	"file_id" text NOT NULL,
	"chunk_index" integer NOT NULL,
	"is_last" boolean NOT NULL,
	"original_name" text,
	"size" integer NOT NULL,
	CONSTRAINT "chunk_metadata_scope_pk" PRIMARY KEY("user_id","google_account_id","media_key")
);
--> statement-breakpoint
CREATE TABLE "google_account_group" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "google_account_group_user_id_id_unique" UNIQUE("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "google_account_group_member" (
	"user_id" text NOT NULL,
	"group_id" text NOT NULL,
	"google_account_id" text NOT NULL,
	CONSTRAINT "google_account_group_member_pk" PRIMARY KEY("user_id","group_id","google_account_id")
);
--> statement-breakpoint
ALTER TABLE "chunk_metadata" ADD CONSTRAINT "chunk_metadata_account_fk" FOREIGN KEY ("user_id","google_account_id") REFERENCES "public"."google_account"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "google_account_group" ADD CONSTRAINT "google_account_group_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "google_account_group_member" ADD CONSTRAINT "google_account_group_member_group_fk" FOREIGN KEY ("user_id","group_id") REFERENCES "public"."google_account_group"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "google_account_group_member" ADD CONSTRAINT "google_account_group_member_account_fk" FOREIGN KEY ("user_id","google_account_id") REFERENCES "public"."google_account"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "google_account_group_member_account_idx" ON "google_account_group_member" USING btree ("user_id","google_account_id");
