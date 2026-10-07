using System;
using System.Linq;
using NUnit.Framework;

namespace Smap.MapImporter.Tests
{
    public class SmapWatchQueueTests
    {
        static readonly Func<string[]> NoMaps = () => throw new AssertionException("must not list maps without an overflow");

        [Test]
        public void DebouncesFiltersAndDedupes()
        {
            var q = new SmapWatchQueue(0.4);
            Assert.IsNull(q.Take(0, NoMaps));
            q.Add("/p/Assets/Maps/a.smapmap", 1.0);
            q.Add("/p/Assets/Maps/A.SMAPMAP", 1.1);
            q.Add("/p/Assets/Maps/grass.png", 1.2);
            q.Add("/p/Assets/Maps/.a.smapmap.12.0.smap-tmp", 1.2);
            q.Add("/p/Assets/Maps/a.smapmap.meta", 1.2);
            Assert.IsNull(q.Take(1.5, NoMaps), "still inside the quiet period");
            var paths = q.Take(1.7, NoMaps);
            CollectionAssert.AreEquivalent(new[] { "/p/Assets/Maps/a.smapmap", "/p/Assets/Maps/grass.png" }, paths);
            Assert.IsNull(q.Take(5, NoMaps), "taken once");
        }

        [Test]
        public void OverflowQueuesEveryMap()
        {
            var q = new SmapWatchQueue(0.4);
            q.Add("/p/Assets/Maps/grass.png", 1.0);
            q.Overflow(1.1);
            Assert.IsNull(q.Take(1.3, NoMaps), "an overflow is debounced too");
            int listed = 0;
            var paths = q.Take(2.0, () =>
            {
                listed++;
                return new[] { "/p/Assets/Maps/a.smapmap", "/p/Assets/Other/b.smapmap" };
            });
            Assert.AreEqual(1, listed);
            CollectionAssert.AreEquivalent(
                new[] { "/p/Assets/Maps/grass.png", "/p/Assets/Maps/a.smapmap", "/p/Assets/Other/b.smapmap" }, paths);
            // The rescan is done; the next batch is a normal one again.
            q.Add("/p/Assets/Maps/a.smapmap", 3.0);
            CollectionAssert.AreEqual(new[] { "/p/Assets/Maps/a.smapmap" }, q.Take(4.0, NoMaps));
        }

        [Test]
        public void OverflowAloneTriggersARescan()
        {
            var q = new SmapWatchQueue(0.4);
            q.Overflow(1.0);
            var paths = q.Take(2.0, () => new[] { "/p/Assets/a.smapmap" });
            CollectionAssert.AreEqual(new[] { "/p/Assets/a.smapmap" }, paths.ToArray());
        }
    }
}
