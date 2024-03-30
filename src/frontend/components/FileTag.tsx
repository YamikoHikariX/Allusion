/* eslint-disable @typescript-eslint/no-unused-vars */
import { observer } from 'mobx-react-lite';
import React, { useCallback } from 'react';

import { Row, Tag } from 'widgets';
import { IconSet } from 'widgets/icons';
import { Menu, useContextMenu } from 'widgets/menus';
import { FileTagMenuItems } from '../containers/ContentView/menu-items';
import { useStore } from '../contexts/StoreContext';
import { ClientFile } from '../entities/File';
import { ClientTag } from '../entities/Tag';
import { TagSelector } from './TagSelector';

const TagCell = observer(({ file, tag }: { file: ClientFile; tag: ClientTag }) => {
  const fileHasTag = file.tags.has(tag);
  const tagColor = tag.color;

  const handleTagClick = () => {
    if (fileHasTag) {
      file.removeTag(tag);
    } else {
      file.addTag(tag);
    }
  };

  return (
    <td
      style={{
        backgroundColor: fileHasTag ? 'green' : 'gray',
        textAlign: 'center',
        color: 'white',
        borderRadius: '5px',
        padding: '3px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}
      onClick={handleTagClick}
    >
      {tag.name}
    </td>
  );
});

const FileTags = ({ file }: { file: ClientFile }) => {
  const { tagStore } = useStore();

  const renderCreateOption = useCallback(
    (tagName: string, resetTextBox: () => void) => (
      <Row
        id="file-tags-create-option"
        key="create"
        value={`Create tag "${tagName}"`}
        icon={IconSet.TAG_ADD}
        onClick={async () => {
          const tag = await tagStore.create(tagStore.root, tagName);
          file.addTag(tag);
          resetTextBox();
        }}
      />
    ),
    [file, tagStore],
  );

  const show = useContextMenu();
  const handleTagContextMenu = useCallback(
    (event: React.MouseEvent<HTMLElement>, tag: ClientTag) => {
      event.stopPropagation();
      show(
        event.clientX,
        event.clientY,
        <Menu>
          <FileTagMenuItems file={file} tag={tag} />
        </Menu>,
      );
    },
    [file, show],
  );

  return (
    <div style={{ overflow: 'auto', alignSelf: 'center' }}>
      <table>
        <tbody>
          <tr>
            <td>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: '0.5rem',
                }}
              >
                {tagStore.tagList.map((tag) => (
                  <TagCell key={tag.id} file={file} tag={tag} />
                ))}
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
};

export default FileTags;
