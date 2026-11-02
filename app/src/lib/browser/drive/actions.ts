type ActionState = {
    busy: boolean;
    fileAction: unknown;
    library: { loading: boolean };
    bulk: { running: boolean; moveBusy: boolean };
};

type ManageState = { busy: boolean };

export function actionsUnavailable(drive: ActionState, manage: ManageState): boolean {
    return (
        drive.busy ||
        !!drive.fileAction ||
        manage.busy ||
        drive.bulk.running ||
        drive.bulk.moveBusy ||
        drive.library.loading
    );
}
