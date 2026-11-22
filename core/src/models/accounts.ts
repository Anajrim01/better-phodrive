import { z } from 'zod';

export const EmailSchema = z.email();

export const AasTokenSchema = z.string().startsWith('aas_et/');

export const SelectedAccountSchema = z.union([EmailSchema, z.literal('')]);

export const AccountSchema = z.object({
    email: EmailSchema,
    token: AasTokenSchema
});

export const NewAccountSchema = z.object({
    email: z.email({ error: 'Enter a valid Google account email.' }),
    token: z
        .string()
        .refine((value) => value.startsWith('oauth2_') || value.startsWith('aas_et/'), {
            error: 'Enter an OAuth2 token starting with oauth2_ or an AAS token starting with aas_et/.'
        })
});

export const StoredAccountsSchema = z.record(z.string(), z.unknown());

export const AccountRequestSchema = z.object({ email: EmailSchema, token: z.string() });

export const GroupNameSchema = z.string().trim().min(1).max(80);

/** The authenticated drive selects a Google account by its stable server-side row id. */
export const GOOGLE_ACCOUNT_HEADER = 'x-phodrive-account-id';

export const GoogleAccountSummarySchema = z.object({
    id: z.string().min(1),
    email: EmailSchema
});

export const GoogleAccountGroupSchema = z.object({
    id: z.string().min(1),
    name: GroupNameSchema,
    members: z.array(GoogleAccountSummarySchema)
});

export type Account = z.infer<typeof AccountSchema>;
export type GroupName = z.infer<typeof GroupNameSchema>;
export type GoogleAccountSummary = z.infer<typeof GoogleAccountSummarySchema>;
export type GoogleAccountGroup = z.infer<typeof GoogleAccountGroupSchema>;
