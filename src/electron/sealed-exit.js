/** Allow desktop exit only after asynchronous user-space sealing succeeds. */
export function createSealedExitHandler(seal, quit, failed) {
    let pending = false;
    let ready = false;
    return event => {
        if (ready) return true;
        event.preventDefault();
        if (!pending) {
            pending = true;
            void Promise.resolve().then(seal).then(() => { ready = true; quit(); }).catch(error => { pending = false; failed(error); });
        }
        return false;
    };
}
