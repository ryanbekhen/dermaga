import { useEffect, useRef, useState } from 'react';
import { FileCode, FolderOpen } from 'lucide-react';
import { Checkbox, Field, Fieldset, FormPage } from '../components/form';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { SegmentedControl } from '../components/SegmentedControl';
import { DockerfileEditor } from '../components/DockerfileEditor';
import { api } from '../services/api';
import { pickDirectory } from '../services/ipc';
import { runTask } from '../services/tasks';
import { useActiveProject } from '../hooks/useActiveProject';
import { askBeforeLeaving, useUIStore } from '../store/uiStore';
import { useValidation } from '../hooks/useValidation';
import { absolutePath, envText, imageReference, required } from '../utils/validate';
import { list } from '../utils/format';
import { DEFAULT_PROJECT, EVERYTHING, prefixed, SEPARATOR } from '../utils/projects';
import type { BuildDrop, BuildSpec, Route } from '../types';

/**
 * The build form, as a page.
 *
 * It was a dialog over the image list, and it is the wrong size for one: a
 * pasted Dockerfile is a text editor, and an editor inside a panel that is
 * itself inside a scrolling body is two scrollbars deep before a line is
 * typed. A build is also not a question to be answered and dismissed -- it is
 * minutes of work started from here and watched from the title bar.
 *
 * Everything it needs travels on the route, because there are three ways in:
 * the button on the Images page, a search that asked for one half or the
 * other, and a Dockerfile dropped anywhere on the window -- which is why it
 * remembers where it was opened from rather than assuming the image list.
 */
export function ImageBuildPage({ route }: { route: Extract<Route, { name: 'image-build' }> }) {
  const back = useUIStore((s) => s.back);

  return (
    <BuildForm
      // A second Dockerfile dropped while this is open is a different form,
      // not the same one with new props: the fields take their values once, at
      // mount, so without a key of its own the drop would land on a form that
      // quietly ignored it.
      key={dropKey(route.drop)}
      from={route.start ?? 'folder'}
      drop={route.drop}
      backTo={cameFrom(route.from)}
      onClose={back}
    />
  );
}

/** What makes one opening of the build form a different one from the last. */
function dropKey(drop: BuildDrop | undefined): string {
  return drop ? `${drop.context}/${drop.dockerfile ?? ''}` : 'typed';
}

/**
 * What to call the page this was opened from.
 *
 * A drop is caught wherever it lands, so this is not always the image list --
 * and a link back to Images from a page somebody opened while reading a
 * container's logs is a link to somewhere they were not.
 */
function cameFrom(from: Route | undefined): string {
  switch (from?.name) {
    case undefined:
    case 'images':
      return 'Images';
    case 'containers':
      return 'Containers';
    case 'container':
      return 'Container';
    case 'volumes':
      return 'Volumes';
    case 'networks':
      return 'Networks';
    case 'machines':
      return 'Machines';
    case 'system':
      return 'System';
    default:
      return 'Back';
  }
}

/**
 * Builds an image from a Dockerfile. The context directory is the only thing
 * required; everything else maps to a flag the CLI already understands.
 */
function BuildForm({
  from: opened,
  drop,
  backTo,
  onClose,
}: {
  /** Which half was asked for; the toggle still moves between them. */
  from: 'folder' | 'paste';
  /** A Dockerfile dragged onto the window, which answers most of this. */
  drop?: BuildDrop | null;
  backTo: string;
  onClose: () => void;
}) {
  // Two ways in, one dialog. A pasted Dockerfile and a project folder are the
  // same act with the same options -- the tag, the build args, the builder
  // that has to be up -- and splitting them into two dialogs would mean
  // keeping two copies of all of it in step.
  const [from, setFrom] = useState<'folder' | 'paste'>(opened);
  const [text, setText] = useState('');

  // A drop arrives with two of the three answers already in it. The third is
  // only a suggestion -- the folder's own name -- and it opens selected, so
  // typing replaces it and Return accepts it.
  const [context, setContext] = useState(drop?.context ?? '');
  const [dockerfile, setDockerfile] = useState(drop?.dockerfile ?? '');
  // Lowercased on the way in: a drop suggests the folder's own name, and a
  // folder is named by a person -- Portfolio, Client Work -- while a registry
  // will not take a capital letter at all.
  const [tag, setTag] = useState(suggestedTag(drop?.name ?? ''));
  const [target, setTarget] = useState('');
  const [buildArgs, setBuildArgs] = useState('');
  const [noCache, setNoCache] = useState(false);
  const [ssh, setSsh] = useState(false);

  // Builds run inside a buildkit container that does not exist until something
  // starts it. Knowing up front means the first build can start it rather than
  // failing with an error about a container the user never asked for.
  const [builderRunning, setBuilderRunning] = useState<boolean | null>(null);

  // What the Build button has been pressed on, held while the question about
  // it is up: what the dialog describes and what runs are then the same spec,
  // whatever the fields do underneath.
  const [confirming, setConfirming] = useState<BuildSpec | null>(null);

  // The caret belongs in the one field a drop cannot answer. Done here rather
  // than with autoFocus because the field is only sometimes the first thing:
  // opened from the button, the folder is what somebody has come to type.
  const openTask = useUIStore((s) => s.openTask);
  const activeProject = useActiveProject();
  // Shown only while it will actually be applied: a tag naming a registry or an
  // account is where the image will be pushed, and a prefix in front of that
  // would not be a longer name, it would be the wrong one. The agent makes the
  // same exception.
  const tagPrefix =
    activeProject !== EVERYTHING && activeProject !== DEFAULT_PROJECT && !tag.includes('/')
      ? `${activeProject}${SEPARATOR}`
      : '';

  const tagField = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!drop) return;

    tagField.current?.focus();
    tagField.current?.select();
  }, [drop]);

  useEffect(() => {
    void api
      .getBuilder()
      .then((status) => setBuilderRunning(status.running))
      .catch(() => setBuilderRunning(null));
  }, []);

  const choose = async () => {
    const chosen = await pickDirectory('Choose the build context');
    if (chosen) setContext(chosen);
  };

  // A pasted Dockerfile that reaches for files beside it has nothing to
  // resolve them against, so the folder field appears -- rather than the build
  // failing on the line that uses them.
  const pasteNeedsContext = from === 'paste' && /^\s*(copy|add)\b/im.test(text);

  // Two modes asking for different things, so the rules move with them: a
  // folder build resolves everything against its folder, and a pasted
  // Dockerfile has none unless it reaches for one.
  const form = useValidation({
    context: from === 'folder' || pasteNeedsContext ? absolutePath(context, 'A folder') : null,
    text: from === 'paste' ? required(text, 'A Dockerfile') : null,
    tag: from === 'paste' ? (required(tag, 'A tag') ?? imageReference(tag)) : imageReference(tag),
    buildArgs: envText(buildArgs),
  });

  const buildSpec = (): BuildSpec => ({
    context: from === 'paste' && !pasteNeedsContext ? '' : context,
    dockerfileText: from === 'paste' ? text : undefined,
    dockerfile: from === 'paste' ? undefined : dockerfile.trim() || undefined,
    tag: (tagPrefix ? prefixed(activeProject, tag) : tag.trim()) || undefined,
    target: target.trim() || undefined,
    buildArgs: buildArgs
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
    noCache,
    ssh,
    // An image built while a project is open is that project's. Nothing to
    // choose here: the switcher already answered it, and a second place to
    // answer the same question is a second place for the two to disagree.
    project: activeProject || undefined,
  });

  const ask = () => setConfirming(buildSpec());

  const build = (spec: BuildSpec) => {
    const name = nameOf(spec);
    const id = `build:${name}`;

    const start = () =>
      void runTask({ id, kind: 'image', label: name, method: 'images.build', params: spec });

    if (builderRunning === false) {
      // Same row, two steps: the user asked for a build, not for a lesson in
      // how the runtime builds things.
      void runTask({
        id,
        kind: 'image',
        label: name,
        method: 'images.startBuilder',
        params: undefined,
        onDone: (failed) => {
          if (!failed) start();
        },
      });
    } else {
      start();
    }

    // Started, so there is nothing in this form left to lose -- and the page
    // it is about to be replaced by must not be asked about.
    askBeforeLeaving(null);

    // Not back to where the form was opened from: a build is minutes of output,
    // and the first place anybody looks when one goes wrong is that output --
    // so pressing Build lands on it. Both steps file under the same name, so
    // this is the right page either way. Leaving does not stop the run: the
    // strip in the title bar carries it, and this is only a view of the lines.
    openTask(id);
  };

  return (
    <FormPage
      backTo={backTo}
      title="Build image"
      subtitle="Progress appears in the title bar; you can keep working while it builds."
      onClose={onClose}
      onSubmit={() => form.attempt(ask)}
      // What pressing the button will do, where the dialog would have said
      // which key finishes it. It used to be a paragraph at the foot of the
      // form, under the last field, where it read as one more thing to fill in.
      hint={
        builderRunning === false
          ? 'The build container is not running — Dermaga starts it first.'
          : undefined
      }
      footer={
        <>
          <button onClick={onClose} className="btn-ghost">
            Cancel
          </button>
          {/* No "build and run". A build takes minutes, by which time you are
              somewhere else in the app -- and finishing by navigating away
              from whatever that is, to open a form over the top of it, is the
              same interruption as a caret jumping while you type. The image
              lands in the list, and running it is a thing you do when you are
              ready to. */}
          <button onClick={() => form.attempt(ask)} className="btn-primary" disabled={!form.valid}>
            Build
          </button>
        </>
      }
    >
      {/* Which of the two this is. First, because it decides what the rest of
          the page even asks for -- and small, because it is a choice between
          two, not the subject of the page. */}
      <div className="flex items-center gap-3">
        <span className="label-mono">Build from</span>
        <SegmentedControl
          ariaLabel="What to build from"
          value={from}
          onChange={setFrom}
          segments={[
            { value: 'folder', label: 'A folder', icon: FolderOpen },
            { value: 'paste', label: 'A Dockerfile', icon: FileCode },
          ]}
        />
      </div>

      {from === 'paste' ? (
        <>
          {/* Asked first, and required. Nothing can be run without a name, and
              asking for one after somebody has typed fifty lines is asking
              after they have decided they are finished. Not guessed from the
              FROM line either: python:3.12 would suggest "python", which is
              the name of an image already in the list. */}
          <Fieldset legend="Image" columns={2}>
            <Field
              label="Tag"
              hint={
                tagPrefix
                  ? `Named for ${activeProject}. A tag with a registry or account in it is left as typed.`
                  : 'Names the image this builds. Required — Run needs something to start.'
              }
              {...form.field('tag')}
            >
              <div className="input flex items-center gap-0 p-0 focus-within:border-brand-600">
                {tagPrefix && (
                  <span className="shrink-0 select-none py-1.5 pl-2.5 font-mono text-code text-ink-500 dark:text-ink-400">
                    {tagPrefix}
                  </span>
                )}
                <input
                  value={tag}
                  onChange={(e) => setTag(e.target.value)}
                  placeholder="my-api:dev"
                  autoFocus
                  className={`min-w-0 flex-1 bg-transparent py-1.5 pr-2.5 outline-hidden ${
                    tagPrefix ? 'pl-0' : 'pl-2.5'
                  }`}
                />
              </div>
            </Field>

            <Field
              label="Target stage"
              hint="Stops at a named stage in a multi-stage build. Optional."
            >
              <input
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder="builder"
                className="input"
              />
            </Field>
          </Fieldset>

          {/* The group carries the validation rather than a Field inside it:
              the editor is the whole card, and a label above a box that is
              already labelled by the card it fills is the same word twice. */}
          <Fieldset
            legend="Dockerfile"
            hint="Written to a directory of its own for the build, and removed when it finishes."
            {...form.field('text')}
          >
            <DockerfileEditor value={text} onChange={setText} />

            {/* A pasted Dockerfile that reaches for files beside it has nothing
                to resolve them against, so this appears rather than the build
                failing on the line that uses them. */}
            {pasteNeedsContext && (
              <Field
                label="Context"
                hint="COPY and ADD need a folder to resolve against. A pasted Dockerfile has none of its own."
                {...form.field('context')}
              >
                <ContextInput
                  value={context}
                  onChange={setContext}
                  onChoose={() => void choose()}
                />
              </Field>
            )}
          </Fieldset>
        </>
      ) : (
        <>
          <Fieldset legend="Source">
            <Field
              label="Context"
              hint="The folder COPY and ADD paths are resolved from."
              {...form.field('context')}
            >
              <ContextInput
                value={context}
                onChange={setContext}
                onChoose={() => void choose()}
                autoFocus={!drop}
              />
            </Field>

            <Field label="Dockerfile" hint="Relative to the context. Defaults to ./Dockerfile.">
              <input
                value={dockerfile}
                onChange={(e) => setDockerfile(e.target.value)}
                placeholder="Dockerfile"
                className="input"
              />
            </Field>
          </Fieldset>

          <Fieldset legend="Image" columns={2}>
            <Field
              label="Tag"
              hint="Names the result, for example api:dev. Optional."
              {...form.field('tag')}
            >
              <input
                ref={tagField}
                value={tag}
                onChange={(e) => setTag(e.target.value)}
                placeholder="api:dev"
                className="input"
              />
            </Field>

            <Field
              label="Target stage"
              hint="Stops at a named stage in a multi-stage build. Optional."
            >
              <input
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder="builder"
                className="input"
              />
            </Field>
          </Fieldset>
        </>
      )}

      {/* Everything that changes how it is built rather than what is built. */}
      <Fieldset legend="Options">
        <Field label="Build arguments" hint="One KEY=value per line." {...form.field('buildArgs')}>
          <textarea
            value={buildArgs}
            onChange={(e) => setBuildArgs(e.target.value)}
            rows={4}
            placeholder={'VERSION=1.2.3\nNODE_ENV=production'}
            className="textarea font-mono"
          />
        </Field>

        <Checkbox checked={noCache} onChange={setNoCache} label="Build without the cache" />
        {/* What a Dockerfile needs to reach a private repository. The agent is
            reached through a socket while a step runs and nothing is written
            into the image, which is the difference between this and copying a
            key in and hoping a later layer removes it. */}
        <Checkbox
          checked={ssh}
          onChange={setSsh}
          label="Forward the SSH agent, for private repositories"
        />
      </Fieldset>

      {confirming && (
        <ConfirmDialog
          {...asked(confirming, builderRunning === false)}
          onConfirm={() => {
            const spec = confirming;
            setConfirming(null);
            build(spec);
          }}
          onCancel={() => setConfirming(null)}
        />
      )}
    </FormPage>
  );
}

/** A folder, and the Finder panel that fills it in. */
function ContextInput({
  value,
  onChange,
  onChoose,
  autoFocus = false,
}: {
  value: string;
  onChange: (value: string) => void;
  onChoose: () => void;
  autoFocus?: boolean;
}) {
  return (
    <div className="flex gap-2">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="/Users/you/projects/api"
        autoFocus={autoFocus}
        className="input min-w-0 flex-1"
      />
      <button onClick={onChoose} className="btn-ghost shrink-0">
        <FolderOpen size={13} aria-hidden />
        Choose…
      </button>
    </div>
  );
}

/**
 * What the image will be called.
 *
 * The tag, if there is one. A folder build without one still has to be called
 * something in the task strip, and the folder's own name is what somebody
 * would have typed anyway.
 */
export function nameOf(spec: BuildSpec): string {
  const folder = suggestedTag(spec.context.replace(/\/+$/, '').split('/').pop() ?? '');

  return spec.tag?.trim() || folder || 'image';
}

/**
 * A folder's name, as a tag it can actually be.
 *
 * The only suggestion this form makes comes from a folder, and a folder is
 * named by a person: `Portfolio`, `Client Work`, `api (old)`. A registry takes
 * none of that -- an uppercase letter is refused outright -- so a suggestion
 * offered as it stands would open the form already answering back, over a
 * field the user never touched.
 *
 * Only the suggestion is treated this way. What somebody types is theirs, and
 * the validation says what is wrong with it rather than quietly rewriting it
 * under the caret.
 */
export function suggestedTag(name: string): string {
  return (
    name
      .toLowerCase()
      // Everything an image name cannot carry, however much of it there is in
      // a row, becomes the one separator that reads as a word break.
      .replace(/[^a-z0-9_.-]+/g, '-')
      // It has to begin and end on a letter or a digit.
      .replace(/^[^a-z0-9]+/, '')
      .replace(/[^a-z0-9]+$/, '')
  );
}

/**
 * The question the Build button asks.
 *
 * A build is minutes of work against a folder somebody typed the path of, so
 * this is the last place to notice that the path is the wrong project, that
 * the tag still says the last thing they built, or that the cache is off when
 * it did not need to be. Only what was set: a page of defaults read back is a
 * page nobody reads.
 *
 * Build arguments are named and not quoted -- what people put in them is
 * versions and tokens, and a dialog is not the place to put a token on screen.
 */
export function asked(
  spec: BuildSpec,
  startingBuilder: boolean
): { title: string; body: string; confirmLabel: string } {
  const sentences: string[] = [];

  if (spec.dockerfileText !== undefined) {
    sentences.push(
      spec.context
        ? `The Dockerfile you pasted is built against ${spec.context}.`
        : 'The Dockerfile you pasted is built on its own, with no folder behind it.'
    );
  } else {
    sentences.push(`${spec.context} is built with ${spec.dockerfile ?? 'its own Dockerfile'}.`);
  }

  sentences.push(
    spec.tag
      ? `The image is tagged ${spec.tag}.`
      : 'The image is left untagged — it lands in the list under its digest.'
  );

  if (spec.target) sentences.push(`It stops at the ${spec.target} stage.`);

  const args = spec.buildArgs ?? [];
  if (args.length > 0) {
    const names = args.map((argument) => argument.split('=')[0].trim());
    sentences.push(`${list(names)} ${args.length === 1 ? 'is' : 'are'} passed as build arguments.`);
  }

  if (spec.noCache) sentences.push('The cache is not used, so every step runs again.');
  if (spec.ssh) {
    sentences.push(
      'This Mac\u2019s SSH agent is reachable from the build, so a step can clone a private repository. No key is written into the image.'
    );
  }
  if (startingBuilder) {
    sentences.push('The build container is not running yet, so it is started first.');
  }

  return {
    title: `Build ${nameOf(spec)}?`,
    body: sentences.join(' '),
    confirmLabel: 'Build',
  };
}
