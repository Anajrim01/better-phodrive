CREATE TABLE "file_location" (
	"user_id" text NOT NULL,
	"google_account_email" text NOT NULL,
	"media_key" text NOT NULL,
	"file_id" text NOT NULL,
	"name" text,
	"folder" text,
	CONSTRAINT "file_location_scope_pk" PRIMARY KEY("user_id","google_account_email","media_key","file_id")
);
--> statement-breakpoint
ALTER TABLE "share_file" ADD COLUMN "original_name" text;--> statement-breakpoint
ALTER TABLE "file_location" ADD CONSTRAINT "file_location_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;