import React from 'react';
import { observer } from 'mobx-react-lite';

import { useStore } from '../../contexts/StoreContext';
import FileTags from '../../components/FileTag';
import ImageInfo from '../../components/ImageInfo';
import { IS_PREVIEW_WINDOW } from 'common/window';

const Inspector = observer(() => {
  const { uiStore, fileStore } = useStore();

  if (uiStore.firstItem >= fileStore.fileList.length || !uiStore.isInspectorOpen) {
    return (
      <aside id="inspector">
        <Placeholder />
      </aside>
    );
  }

  const first = fileStore.fileList[uiStore.firstItem];

  return (
    <aside id="inspector">
      <section>
        <ImageInfo file={first} />
      </section>
      {/* Modifying state in preview window is not supported (not in sync updated in main window) */}
      {!IS_PREVIEW_WINDOW && (
        <section>
          <header>
            <h2>Tags</h2>
          </header>
          <FileTags file={first} />
        </section>
      )}
    </aside>
  );
});

export default Inspector;

const Placeholder = () => {
  return (
    <section>
      <header>
        <h2>No image selected</h2>
      </header>
    </section>
  );
};
