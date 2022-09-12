// This file is required by the index.html file and will
// be executed in the renderer process for that window.
// All of the Node.js APIs are available in this process.

import React from 'react';
import ReactDOM from 'react-dom';
import { autorun, flow, reaction, runInAction } from 'mobx';

// Import the styles here to let Webpack know to include them
// in the HTML file
import './style.scss';

import { RendererMessenger } from 'src/ipc/renderer';

import Backend from './backend/backend';

import StoreProvider from './frontend/contexts/StoreContext';
import RootStore from './frontend/stores/RootStore';
import { FILE_STORAGE_KEY } from './frontend/stores/FileStore';
import { PREFERENCES_STORAGE_KEY } from './frontend/stores/UiStore';
import App from './frontend/App';
import PreviewApp from './frontend/Preview';
import Overlay from './frontend/Overlay';
import { IS_PREVIEW_WINDOW, WINDOW_STORAGE_KEY } from 'common/window';
import { CancellablePromise } from 'common/promise';
import { promiseRetry, sleep } from '../common/timeout';
import SplashScreen from './frontend/containers/SplashScreen';
import { ConditionDTO } from './api/data-storage-search';
import { FileDTO } from './api/file';

(async function main(): Promise<void> {
  const container = document.getElementById('app');

  if (container === null) {
    throw new Error();
  }

  ReactDOM.render(<SplashScreen />, container);

  // Initialize the backend for the App, that serves as an API to the front-end
  const backend = await Backend.init();
  console.log('Backend has been initialized!');

  const SPLASH_SCREEN_TIME = 1400;

  const [[rootStore, Component]] = await Promise.all([
    !IS_PREVIEW_WINDOW ? setupMainApp(backend) : setupPreviewApp(backend),
    new Promise((resolve) => setTimeout(resolve, SPLASH_SCREEN_TIME)),
  ]);

  autorun(() => {
    document.title = rootStore.getWindowTitle();
  });

  // Render our react components in the div with id 'app' in the html file
  // The Provider component provides the state management for the application
  ReactDOM.render(
    <StoreProvider value={rootStore}>
      <Component />
      <Overlay />
    </StoreProvider>,
    container,
  );

  window.addEventListener('beforeunload', () => {
    // TODO: check whether this works okay with running in background process
    // And when force-closing the application. I think it might be keep running...
    // Update: yes, it keeps running when force-closing. Not sure how to fix. Don't think it can run as child-process
    rootStore.exifTool.close();
  });

  // -------------------------------------------
  // Messaging with the main process
  // -------------------------------------------

  RendererMessenger.onImportExternalImage(async ({ item }) => {
    console.log('Importing image...', item);
    // Might take a while for the file watcher to detect the image - otherwise the image is not in the DB and cannot be tagged
    promiseRetry(() => addTagsToFile(item.filePath, item.tagNames));
  });

  RendererMessenger.onAddTagsToFile(async ({ item }) => {
    console.log('Adding tags to file...', item);
    await addTagsToFile(item.filePath, item.tagNames);
  });

  RendererMessenger.onGetTags(async () => ({ tags: await backend.fetchTags() }));

  RendererMessenger.onFullScreenChanged((val) => rootStore.uiStore.setFullScreen(val));

  /**
   * Adds tags to a file, given its name and the names of the tags
   * @param filePath The path of the file
   * @param tagNames The names of the tags
   */
  async function addTagsToFile(filePath: string, tagNames: string[]) {
    const { fileStore, tagStore } = rootStore;
    const clientFile = runInAction(() =>
      fileStore.fileList.find((file) => file.absolutePath === filePath),
    );
    if (clientFile) {
      const tags = await Promise.all(
        tagNames.map(async (tagName) => {
          const clientTag = tagStore.findByName(tagName);
          if (clientTag !== undefined) {
            return clientTag;
          } else {
            const newClientTag = await tagStore.create(tagStore.root, tagName);
            return newClientTag;
          }
        }),
      );
      tags.forEach(clientFile.addTag);
    } else {
      throw new Error('Could not find image to set tags for ' + filePath);
    }
  }
})();

async function setupMainApp(backend: Backend): Promise<[RootStore, () => JSX.Element]> {
  const [rootStore] = await Promise.all([RootStore.main(backend), backend.setupBackup()]);
  RendererMessenger.initialized();

  RendererMessenger.onClosedPreviewWindow(() => {
    rootStore.uiStore.closePreviewWindow();
  });

  // Recover global preferences
  try {
    const window_preferences = localStorage.getItem(WINDOW_STORAGE_KEY);
    if (window_preferences === null) {
      localStorage.setItem(WINDOW_STORAGE_KEY, JSON.stringify({ isFullScreen: false }));
    } else {
      const prefs = JSON.parse(window_preferences);
      if (prefs.isFullScreen === true) {
        RendererMessenger.setFullScreen(true);
        rootStore.uiStore.setFullScreen(true);
      }
    }
  } catch (e) {
    console.error('Cannot load window preferences', e);
  }

  // Debounced and automatic storing of preferences
  reaction(
    () => rootStore.fileStore.getPersistentPreferences(),
    (preferences) => {
      localStorage.setItem(FILE_STORAGE_KEY, JSON.stringify(preferences));
    },
    { delay: 200 },
  );

  reaction(
    () => rootStore.uiStore.getPersistentPreferences(),
    (preferences) => {
      localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
    },
    { delay: 200 },
  );

  const fetchTask = flow(function* fetch(
    showsMissingContent: boolean,
    conditions: ConditionDTO<FileDTO>[],
    matchAny: boolean,
  ) {
    const DELAY = 200;
    // We are waiting here instead of passing a value to the delay option of the reaction function in order to be able
    // to cancel the task immediately in the reaction. Otherwise, it could happen that a fetch begins but the
    // dependencies change again before DELAY milliseconds passed. By the time the reaction has run again, it might be
    // finished already.
    yield sleep(DELAY);

    if (showsMissingContent) {
      yield* rootStore.fileStore.fetchMissingFiles();
    } else {
      if (conditions.length === 0) {
        yield* rootStore.fileStore.fetchAllFiles();
      } else {
        yield* rootStore.fileStore.fetchFilesByQuery(
          conditions as [ConditionDTO<FileDTO>, ...ConditionDTO<FileDTO>[]],
          matchAny,
        );
      }
    }
  });

  // The reaction runs immediately and synchrounously which is why there is no need for a queue.
  let runningTask: CancellablePromise<void> | undefined = undefined;

  // Debounced and automatic fetching
  reaction(
    () => {
      return [
        rootStore.uiStore.showsMissingContent,
        rootStore.uiStore.searchCriteriaList.map((criteria) => criteria.toCondition(rootStore)),
        rootStore.uiStore.searchMatchAny,
        // Other dependencies a query relies on
        rootStore.fileStore.orderBy,
        rootStore.fileStore.orderDirection,
        rootStore.tagStore.hiddenTagIDs,
        // Forces refetch
        rootStore.fetchToken,
      ] as const;
    },
    ([showsMissingContent, conditions, matchAny]) => {
      runningTask?.cancel();
      runningTask = fetchTask(showsMissingContent, conditions, matchAny);
      runningTask.catch(() =>
        console.debug('Cancelled fetch request:', { showsMissingContent, conditions, matchAny }),
      );
    },
  );

  return [rootStore, App];
}

async function setupPreviewApp(backend: Backend): Promise<[RootStore, () => JSX.Element]> {
  const rootStore = await RootStore.preview(backend);
  RendererMessenger.initialized();

  await new Promise<void>((resolve) => {
    let fetchTask: CancellablePromise<void> = sleep(0);
    let executor: (() => void) | undefined = resolve;

    RendererMessenger.onReceivePreviewFiles((message) => {
      fetchTask.cancel();
      fetchTask = flow(function* fetchReceivedFiles() {
        const { ids, thumbnailDirectory, viewMethod, activeImgId } = message;
        const { fileStore, locationStore, uiStore } = rootStore;
        uiStore.setThumbnailDirectory(thumbnailDirectory);
        uiStore.setMethod(viewMethod);
        uiStore.enableSlideMode();
        uiStore.isInspectorOpen = false;

        yield* fileStore.fetchFilesByIDs(ids);
        // If a file has a location we don't know about (e.g. when a new location was added to the main window),
        // re-fetch the locations in the preview window.
        const hasNewLocation = fileStore.fileList.some(
          (file) => !locationStore.locationList.some((location) => location.id === file.locationId),
        );

        if (hasNewLocation) {
          yield locationStore.init();
        }

        const firstItem = activeImgId !== undefined ? fileStore.getIndex(activeImgId) ?? 0 : 0;
        uiStore.setFirstItem(firstItem);

        // Does this release the memory?
        if (executor !== undefined) {
          executor();
          executor = undefined;
        }
      })();
    });
  });

  // Close preview with space
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === ' ' || e.key === 'Escape') {
      rootStore.uiStore.clearFileSelection();
      rootStore.fileStore.clearFileList();
      rootStore.uiStore.enableSlideMode();

      // remove focus from element so closing preview with spacebar does not trigger any ui elements
      if (document.activeElement && document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }

      window.close();
    }
  });

  return [rootStore, PreviewApp];
}
