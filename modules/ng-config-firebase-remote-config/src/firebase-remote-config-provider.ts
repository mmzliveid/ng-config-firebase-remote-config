import { Inject, Injectable, NgZone, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

import { remoteConfig } from 'firebase/app';

import { EMPTY, Observable, of, pipe } from 'rxjs';
import { distinctUntilChanged, filter, map, observeOn, shareReplay, startWith, switchMap, tap } from 'rxjs/operators';

import { ConfigProvider } from '@dagonmetric/ng-config';

// eslint-disable-next-line prefer-arrow/prefer-arrow-functions
function mapToObject() {
    return pipe(
        map((rcConfigObject) => {
            const allkeys = Object.keys(rcConfigObject || {});
            const obj: { [key: string]: string } = {};
            for (const key of allkeys) {
                obj[key] = rcConfigObject[key].asString();
            }

            return obj;
        }),
        distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b))
    );
}

import {
    FIREBASE_REMOTE_CONFIG_PROVIDER_OPTIONS,
    FirebaseRemoteConfigProviderOptions
} from './firebase-remote-config-provider-options';
import { firebaseAppFactory } from './firebase-app-factory';
import { ZoneScheduler } from './zone-helpers';

declare let Zone: any;

export interface ConfigObjectTemplate {
    [key: string]: string;
}

@Injectable({
    providedIn: 'any'
})
export class FirebaseRemoteConfigProvider implements ConfigProvider {
    get name(): string {
        return 'FirebaseRemoteConfigProvider';
    }

    get data(): { [key: string]: string } | null {
        return this.cachedData || null;
    }

    private readonly isBrowser: boolean;
    private readonly rc: Observable<remoteConfig.RemoteConfig>;

    private cachedData?: { [key: string]: string } | null;

    constructor(
        @Inject(FIREBASE_REMOTE_CONFIG_PROVIDER_OPTIONS)
        private readonly options: FirebaseRemoteConfigProviderOptions,
        // tslint:disable-next-line: ban-types
        @Inject(PLATFORM_ID) platformId: Object,
        private readonly ngZone: NgZone
    ) {
        this.isBrowser = isPlatformBrowser(platformId);

        const rc$ = of(undefined).pipe(
            observeOn(this.ngZone.runOutsideAngular(() => new ZoneScheduler(Zone.current))),
            switchMap(() => (this.isBrowser ? import('firebase/remote-config') : EMPTY)),
            map(() => firebaseAppFactory(this.options.firebaseConfig, this.ngZone, this.options.appName)),
            map((app) => app.remoteConfig()),
            tap((rc) => {
                if (this.options.remoteConfigSettings) {
                    rc.settings = this.options.remoteConfigSettings;
                }
            }),
            startWith(undefined as remoteConfig.RemoteConfig),
            shareReplay({ bufferSize: 1, refCount: false })
        );

        this.rc = rc$.pipe(filter<remoteConfig.RemoteConfig>((rc) => !!rc));
    }

    load(): Observable<{ [key: string]: string }> {
        const fresh$ = this.rc.pipe(
            switchMap((rc) =>
                this.ngZone.runOutsideAngular(async () => {
                    await rc.activate();

                    if (this.isBrowser && (this.options.throwFetchError || (navigator && navigator.onLine))) {
                        try {
                            await rc.fetchAndActivate();
                        } catch (fetchError) {
                            if (this.options.throwFetchError) {
                                throw fetchError;
                            }
                        }
                    }

                    await rc.ensureInitialized();

                    return rc.getAll();
                })
            )
        );

        return fresh$.pipe(
            mapToObject(),
            tap((configData) => {
                this.cachedData = configData;
            }),
            shareReplay({ bufferSize: 1, refCount: true })
        );
    }
}