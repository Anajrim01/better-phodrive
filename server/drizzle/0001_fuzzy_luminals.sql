CREATE TABLE "chunk_metadata" (
	"user_id" text NOT NULL,
	"google_email" text NOT NULL,
	"media_key" text NOT NULL,
	"sha1" text NOT NULL,
	"stored_bmp_size" integer NOT NULL,
	"file_hash" text NOT NULL,
	"file_id" text NOT NULL,
	"chunk_index" integer NOT NULL,
	"is_last" boolean NOT NULL,
	"original_name" text,
	"size" integer NOT NULL,
	CONSTRAINT "chunk_metadata_scope_pk" PRIMARY KEY("user_id","google_email","media_key")
);
--> statement-breakpoint
ALTER TABLE "chunk_metadata" ADD CONSTRAINT "chunk_metadata_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;